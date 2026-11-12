import { Inject, Injectable } from '@nestjs/common';
import { badRequest } from '../../common/errors.js';
import { decodeGstin, GST_STATES, gstStateByName } from '../../common/india.js';
import { logger } from '../../common/logger.js';
import { nearbyPins, stateForPin } from '../../common/pin-region.js';
import { INFRA_CONFIG, type InfraConfig } from '../../config/infra.config.js';
import { RedisService } from '../../core/redis.service.js';

export interface PincodeResult {
  pincode: string;
  found: boolean;
  /** the district, which is what people write as the city for most PIN codes */
  city: string | null;
  district: string | null;
  stateName: string | null;
  stateCode: string | null;
  /** post office names under this PIN, for the address's second line */
  localities: string[];
  /**
   * exact: India Post lists this PIN. nearby: it does not (newer PINs often aren't yet), so the district and state
   * come from the closest listed PIN in the same sorting district. region: only the state, from the first digits.
   */
  match: 'exact' | 'nearby' | 'region' | 'none';
  /** for a nearby match, the PIN code the details came from */
  nearbyPincode: string | null;
}

/** Fills forms from what is already known: a PIN code's place, a GSTIN's state and PAN. */
@Injectable()
export class LookupService {
  constructor(
    private readonly redis: RedisService,
    @Inject(INFRA_CONFIG) private readonly infra: InfraConfig,
  ) {}

  states() {
    return GST_STATES;
  }

  gstin(gstin: string) {
    return decodeGstin(gstin);
  }

  /** One PIN code in India Post's directory, cached: a month when listed, a day when not. Null if unreachable. */
  private async directory(pin: string): Promise<Omit<PincodeResult, 'match' | 'nearbyPincode'> | null> {
    const cacheKey = `pincode:v2:${pin}`;
    const cached = await this.redis.client.get(cacheKey);
    if (cached) return JSON.parse(cached) as Omit<PincodeResult, 'match' | 'nearbyPincode'>;
    try {
      const res = await fetch(`${this.infra.pincodeLookupUrl}${pin}`, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } });
      if (!res.ok) return null;
      const body = (await res.json()) as { Status?: string; PostOffice?: { Name?: string; District?: string; State?: string }[] | null }[];
      const offices = body?.[0]?.Status === 'Success' ? (body[0].PostOffice ?? []) : [];
      const first = offices[0];
      const state = first?.State ? gstStateByName(first.State) : null;
      const result = first
        ? { pincode: pin, found: true, city: first.District ?? null, district: first.District ?? null, stateName: state?.name ?? first.State ?? null, stateCode: state?.code ?? null, localities: [...new Set(offices.map((o) => o.Name).filter((x): x is string => !!x))].slice(0, 30) }
        : { pincode: pin, found: false, city: null, district: null, stateName: null, stateCode: null, localities: [] };
      await this.redis.client.set(cacheKey, JSON.stringify(result), 'EX', result.found ? 30 * 24 * 3600 : 24 * 3600);
      return result;
    } catch (err) {
      logger.warn({ err, pin }, 'PIN code lookup unavailable');
      return null;
    }
  }

  /**
   * A PIN code's place, through the server (so the browser's CSP stays strict). India Post's directory first; for a
   * PIN it does not list yet, the nearest listed PIN in the same sorting district gives the district and state;
   * failing that, the state alone comes from the PIN's first digits. The person can always correct what was filled.
   */
  async pincode(pin: string): Promise<PincodeResult> {
    if (!/^[1-9][0-9]{5}$/.test(pin)) throw badRequest('A PIN code is six digits and does not start with 0', [{ field: 'pincode', message: 'Six digits' }]);
    const region = (): PincodeResult => {
      const state = stateForPin(pin);
      return { pincode: pin, found: !!state, city: null, district: null, stateName: state?.name ?? null, stateCode: state?.code ?? null, localities: [], match: state ? 'region' : 'none', nearbyPincode: null };
    };
    if (!this.infra.pincodeLookupUrl) return region();
    const exact = await this.directory(pin);
    if (exact?.found) return { ...exact, match: 'exact', nearbyPincode: null };
    if (!exact) return region(); // the directory is unreachable: don't hammer it with neighbours
    // Closest first, a few at a time, stopping at the first listed one.
    const candidates = nearbyPins(pin);
    for (let i = 0; i < candidates.length; i += 4) {
      const batch = await Promise.all(candidates.slice(i, i + 4).map((p) => this.directory(p)));
      const hit = batch.find((r) => r?.found);
      if (hit) {
        // Its post offices belong to the other PIN, so they are not offered as this address's areas.
        return { pincode: pin, found: true, city: hit.city, district: hit.district, stateName: hit.stateName, stateCode: hit.stateCode, localities: [], match: 'nearby', nearbyPincode: hit.pincode };
      }
      if (batch.every((r) => r === null)) break;
    }
    return region();
  }
}
