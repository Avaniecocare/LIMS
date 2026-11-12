import { ApiProperty } from '@nestjs/swagger';
export class StateDto {
  code: string;
  name: string;
}
export class GstinLookupDto {
  valid: boolean;
  stateCode: string | null;
  stateName: string | null;
  pan: string | null;
}
export class PincodeLookupDto {
  pincode: string;
  found: boolean;
  /** the district, which is what most addresses use as the city */
  city: string | null;
  district: string | null;
  stateName: string | null;
  stateCode: string | null;
  /** post office names under this PIN code */
  localities: string[];
  /** exact: listed by India Post; nearby: filled from the closest listed PIN in the same district; region: state only, from the first digits; none */
  @ApiProperty({ enum: ['exact', 'nearby', 'region', 'none'] }) match: 'exact' | 'nearby' | 'region' | 'none';
  nearbyPincode: string | null;
}
