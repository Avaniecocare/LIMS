/**
 * Lab-type templates: a starting test catalogue for Indian testing laboratories.
 * Built from public standards (IS 10500:2012 with amendments, Environment (Protection) Rules 1986 Schedule VI, CPCB NAAQS 2009, Noise Rules 2000, IS/ASTM test methods), checked 2026-11-10. No prices, nothing marked accredited: each laboratory sets both.
 * Generated data; edit with care. Each template selects departments; tests, specifications and packages follow.
 */
export interface Param { code: string; name: string; kind: string; unit?: string | null; decimals: number; resultSet?: string; formula?: string; bindings?: Record<string, string>; showOnReport?: boolean }
export interface Test { code: string; name: string; category: string; department: string; method: string | null; parameters: Param[]; defaultTatDays: number; urgentTatDays: number; stages: string[] }
export interface Catalogue {
  source: string;
  units: { code: string; name: string; symbol: string }[];
  departments: { code: string; name: string }[];
  resultSets: { code: string; name: string; options: { value: string; isPass: boolean }[] }[];
  methods: { code: string; name: string; standardRef: string | null }[];
  tests: Test[];
  specifications: { code: string; name: string; limits: { test: string; param: string; min: string | null; max: string | null; text: string | null }[] }[];
  groups: { code: string; name: string; tests: string[] }[];
  remarkTemplates: { code: string; text: string; outcome: string }[];
  templates: { id: string; name: string; description: string; departments: string[] }[];
}


export const CATALOGUE: Catalogue = {
 "source": "Built from public standards (IS 10500:2012 with amendments, Environment (Protection) Rules 1986 Schedule VI, CPCB NAAQS 2009, Noise Rules 2000, IS/ASTM test methods), checked 2026-11-10. No prices, nothing marked accredited: each laboratory sets both.",
 "units": [
  {"code": "CEL", "name": "Degree Celsius", "symbol": "°C"},
  {"code": "PCT", "name": "Percent", "symbol": "%"},
  {"code": "GCM3", "name": "Gram per cubic centimetre", "symbol": "g/cm³"},
  {"code": "MM", "name": "Millimetre", "symbol": "mm"},
  {"code": "MM2", "name": "Square millimetre", "symbol": "mm²"},
  {"code": "N", "name": "Newton", "symbol": "N"},
  {"code": "MPA", "name": "Megapascal", "symbol": "MPa"},
  {"code": "J", "name": "Joule", "symbol": "J"},
  {
   "code": "MG_L",
   "name": "Milligrams per litre",
   "symbol": "mg/L"
  },
  {
   "code": "NTU",
   "name": "Nephelometric turbidity units",
   "symbol": "NTU"
  },
  {
   "code": "HAZEN",
   "name": "Hazen units",
   "symbol": "Hazen"
  },
  {
   "code": "US_CM",
   "name": "Microsiemens per centimetre",
   "symbol": "µS/cm"
  },
  {
   "code": "MPN_100ML",
   "name": "Most probable number per 100 mL",
   "symbol": "MPN/100 mL"
  },
  {
   "code": "UG_M3",
   "name": "Micrograms per cubic metre",
   "symbol": "µg/m³"
  },
  {
   "code": "NG_M3",
   "name": "Nanograms per cubic metre",
   "symbol": "ng/m³"
  },
  {
   "code": "MG_M3",
   "name": "Milligrams per cubic metre",
   "symbol": "mg/m³"
  },
  {
   "code": "MG_NM3",
   "name": "Milligrams per normal cubic metre",
   "symbol": "mg/Nm³"
  },
  {
   "code": "PCT_VOL",
   "name": "Percent by volume",
   "symbol": "% v/v"
  },
  {
   "code": "M_S",
   "name": "Metres per second",
   "symbol": "m/s"
  },
  {
   "code": "NM3_H",
   "name": "Normal cubic metres per hour",
   "symbol": "Nm³/h"
  },
  {
   "code": "DBA",
   "name": "Decibels, A-weighted",
   "symbol": "dB(A)"
  },
  {
   "code": "MG_KG",
   "name": "Milligrams per kilogram",
   "symbol": "mg/kg"
  },
  {
   "code": "KG_HA",
   "name": "Kilograms per hectare",
   "symbol": "kg/ha"
  },
  {
   "code": "MEQ_100G",
   "name": "Milliequivalents per 100 g",
   "symbol": "meq/100 g"
  },
  {
   "code": "HBW",
   "name": "Brinell hardness",
   "symbol": "HBW"
  },
  {
   "code": "HRC",
   "name": "Rockwell hardness, C scale",
   "symbol": "HRC"
  },
  {
   "code": "HV",
   "name": "Vickers hardness",
   "symbol": "HV"
  },
  {
   "code": "UM",
   "name": "Micrometres",
   "symbol": "µm"
  },
  {
   "code": "G_M2",
   "name": "Grams per square metre",
   "symbol": "g/m²"
  },
  {
   "code": "HOUR",
   "name": "Hours",
   "symbol": "h"
  }
 ],
 "departments": [
  {
   "code": "WTR",
   "name": "Water and Wastewater"
  },
  {
   "code": "MICRO",
   "name": "Microbiology"
  },
  {
   "code": "AIR",
   "name": "Air and Stack Emission"
  },
  {
   "code": "SOIL",
   "name": "Soil, Sludge and Solid Waste"
  },
  {
   "code": "NOISE",
   "name": "Noise Monitoring"
  },
  {
   "code": "MECH",
   "name": "Mechanical Testing"
  },
  {
   "code": "METL",
   "name": "Metallurgy and Chemical Analysis"
  }
 ],
 "resultSets": [
  {"code": "DETECTED", "name": "Detected / Not detected", "options": [{"value": "Not detected", "isPass": true}, {"value": "Detected", "isPass": false}]},
  {"code": "COMPLIES", "name": "Complies / Does not comply", "options": [{"value": "Complies", "isPass": true}, {"value": "Does not comply", "isPass": false}]},
  {
   "code": "AGREEABLE",
   "name": "Agreeable / Disagreeable",
   "options": [
    {
     "value": "Agreeable",
     "isPass": true
    },
    {
     "value": "Disagreeable",
     "isPass": false
    }
   ]
  },
  {
   "code": "BEND",
   "name": "Bend test outcome",
   "options": [
    {
     "value": "No crack observed",
     "isPass": true
    },
    {
     "value": "Crack observed",
     "isPass": false
    }
   ]
  }
 ],
 "methods": [
  {
   "code": "W-PH",
   "name": "pH value, electrometric",
   "standardRef": "IS 3025 (Part 11)"
  },
  {
   "code": "W-TEMP",
   "name": "Temperature",
   "standardRef": "IS 3025 (Part 9)"
  },
  {
   "code": "W-TURB",
   "name": "Turbidity, nephelometric",
   "standardRef": "IS 3025 (Part 10)"
  },
  {
   "code": "W-COLOUR",
   "name": "Colour, platinum-cobalt (Hazen)",
   "standardRef": "IS 3025 (Part 4)"
  },
  {
   "code": "W-ODOUR",
   "name": "Odour",
   "standardRef": "IS 3025 (Part 5)"
  },
  {
   "code": "W-TASTE",
   "name": "Taste",
   "standardRef": "IS 3025 (Parts 7 and 8)"
  },
  {
   "code": "W-EC",
   "name": "Electrical conductivity",
   "standardRef": "IS 3025 (Part 14)"
  },
  {
   "code": "W-TDS",
   "name": "Total dissolved solids, gravimetric",
   "standardRef": "IS 3025 (Part 16)"
  },
  {
   "code": "W-TSS",
   "name": "Total suspended solids, gravimetric",
   "standardRef": "IS 3025 (Part 17)"
  },
  {
   "code": "W-HARD",
   "name": "Total hardness, EDTA titrimetric",
   "standardRef": "IS 3025 (Part 21)"
  },
  {
   "code": "W-CA",
   "name": "Calcium, EDTA titrimetric",
   "standardRef": "IS 3025 (Part 40)"
  },
  {
   "code": "W-MG",
   "name": "Magnesium",
   "standardRef": "IS 3025 (Part 46)"
  },
  {
   "code": "W-ALK",
   "name": "Alkalinity, titrimetric",
   "standardRef": "IS 3025 (Part 23)"
  },
  {
   "code": "W-CL",
   "name": "Chloride, argentometric",
   "standardRef": "IS 3025 (Part 32)"
  },
  {
   "code": "W-SO4",
   "name": "Sulphate",
   "standardRef": "IS 3025 (Part 24)"
  },
  {
   "code": "W-N",
   "name": "Nitrogen: nitrate, ammonia, Kjeldahl",
   "standardRef": "IS 3025 (Part 34)"
  },
  {
   "code": "W-NO2",
   "name": "Nitrite, colorimetric",
   "standardRef": "APHA 4500-NO2 B"
  },
  {
   "code": "W-F",
   "name": "Fluoride",
   "standardRef": "IS 3025 (Part 60)"
  },
  {
   "code": "W-PO4",
   "name": "Phosphate",
   "standardRef": "IS 3025 (Part 31)"
  },
  {
   "code": "W-NAK",
   "name": "Sodium and potassium, flame photometric",
   "standardRef": "IS 3025 (Part 45)"
  },
  {
   "code": "W-CL2",
   "name": "Residual chlorine and chloramines",
   "standardRef": "IS 3025 (Part 26)"
  },
  {
   "code": "W-DO",
   "name": "Dissolved oxygen, Winkler azide modification",
   "standardRef": "IS 3025 (Part 38)"
  },
  {
   "code": "W-BOD",
   "name": "Biochemical oxygen demand, 3 days at 27 °C",
   "standardRef": "IS 3025 (Part 44)"
  },
  {
   "code": "W-COD",
   "name": "Chemical oxygen demand, dichromate reflux",
   "standardRef": "IS 3025 (Part 58)"
  },
  {
   "code": "W-OG",
   "name": "Oil and grease, partition gravimetric",
   "standardRef": "IS 3025 (Part 39)"
  },
  {
   "code": "W-MINOIL",
   "name": "Mineral oil, infrared partition",
   "standardRef": "IS 3025 (Part 39), clause 6"
  },
  {
   "code": "W-PHENOL",
   "name": "Phenolic compounds",
   "standardRef": "IS 3025 (Part 43)"
  },
  {
   "code": "W-CN",
   "name": "Cyanide",
   "standardRef": "IS 3025 (Part 27)"
  },
  {
   "code": "W-S",
   "name": "Sulphide",
   "standardRef": "IS 3025 (Part 29)"
  },
  {
   "code": "W-MBAS",
   "name": "Anionic detergents (MBAS)",
   "standardRef": "IS 13428, Annex K"
  },
  {
   "code": "W-AL",
   "name": "Aluminium",
   "standardRef": "IS 3025 (Part 55)"
  },
  {
   "code": "W-AS",
   "name": "Arsenic",
   "standardRef": "IS 3025 (Part 37)"
  },
  {
   "code": "W-B",
   "name": "Boron",
   "standardRef": "IS 3025 (Part 57)"
  },
  {
   "code": "W-BA",
   "name": "Barium",
   "standardRef": "IS 13428, Annex F"
  },
  {
   "code": "W-CD",
   "name": "Cadmium",
   "standardRef": "IS 3025 (Part 41)"
  },
  {
   "code": "W-CR",
   "name": "Total chromium",
   "standardRef": "IS 3025 (Part 52)"
  },
  {
   "code": "W-CR6",
   "name": "Hexavalent chromium, diphenylcarbazide",
   "standardRef": "APHA 3500-Cr B"
  },
  {
   "code": "W-CU",
   "name": "Copper",
   "standardRef": "IS 3025 (Part 42)"
  },
  {
   "code": "W-FE",
   "name": "Iron",
   "standardRef": "IS 3025 (Part 53)"
  },
  {
   "code": "W-HG",
   "name": "Mercury",
   "standardRef": "IS 3025 (Part 48)"
  },
  {
   "code": "W-MN",
   "name": "Manganese",
   "standardRef": "IS 3025 (Part 59)"
  },
  {
   "code": "W-MO",
   "name": "Molybdenum",
   "standardRef": "IS 3025 (Part 2)"
  },
  {
   "code": "W-NI",
   "name": "Nickel",
   "standardRef": "IS 3025 (Part 54)"
  },
  {
   "code": "W-PB",
   "name": "Lead",
   "standardRef": "IS 3025 (Part 47)"
  },
  {
   "code": "W-SE",
   "name": "Selenium",
   "standardRef": "IS 3025 (Part 56)"
  },
  {
   "code": "W-AG",
   "name": "Silver",
   "standardRef": "IS 13428, Annex J"
  },
  {
   "code": "W-V",
   "name": "Vanadium, ICP-OES",
   "standardRef": "APHA 3120 B"
  },
  {
   "code": "W-ZN",
   "name": "Zinc",
   "standardRef": "IS 3025 (Part 49)"
  },
  {
   "code": "MB-MF",
   "name": "Coliform bacteria and E. coli, membrane filtration",
   "standardRef": "IS 15185"
  },
  {
   "code": "MB-TC-MPN",
   "name": "Total coliform, multiple-tube fermentation (MPN)",
   "standardRef": "APHA 9221 B"
  },
  {
   "code": "MB-FC-MPN",
   "name": "Faecal coliform, multiple-tube fermentation (MPN)",
   "standardRef": "APHA 9221 E"
  },
  {
   "code": "A-PM10",
   "name": "PM10, gravimetric",
   "standardRef": "IS 5182 (Part 23)"
  },
  {
   "code": "A-PM25",
   "name": "PM2.5, gravimetric",
   "standardRef": "IS 5182 (Part 24)"
  },
  {
   "code": "A-SO2",
   "name": "Sulphur dioxide, improved West and Gaeke",
   "standardRef": "IS 5182 (Part 2)"
  },
  {
   "code": "A-NO2",
   "name": "Nitrogen dioxide, modified Jacob and Hochheiser (Na-arsenite)",
   "standardRef": "IS 5182 (Part 6)"
  },
  {
   "code": "A-CO",
   "name": "Carbon monoxide, non-dispersive infrared (NDIR)",
   "standardRef": "IS 5182 (Part 10)"
  },
  {
   "code": "A-O3",
   "name": "Ozone, chemical method",
   "standardRef": "NAAQS 2009, CPCB"
  },
  {
   "code": "A-NH3",
   "name": "Ammonia, indophenol blue method",
   "standardRef": "NAAQS 2009, CPCB"
  },
  {
   "code": "A-METALS",
   "name": "Metals, AAS/ICP after sampling on EPM 2000 filter",
   "standardRef": "NAAQS 2009, CPCB"
  },
  {
   "code": "A-C6H6",
   "name": "Benzene, adsorption and desorption followed by GC",
   "standardRef": "NAAQS 2009, CPCB"
  },
  {
   "code": "A-BAP",
   "name": "Benzo(a)pyrene, solvent extraction followed by HPLC/GC",
   "standardRef": "NAAQS 2009, CPCB"
  },
  {
   "code": "S-VEL",
   "name": "Stack gas velocity and volumetric flow rate (Type S pitot tube)",
   "standardRef": "USEPA Method 2"
  },
  {
   "code": "S-GAS",
   "name": "Gas analysis for oxygen and carbon dioxide",
   "standardRef": "USEPA Method 3"
  },
  {
   "code": "S-MOIST",
   "name": "Moisture content in stack gases",
   "standardRef": "USEPA Method 4"
  },
  {
   "code": "S-PM",
   "name": "Particulate matter, isokinetic sampling, gravimetric",
   "standardRef": "IS 11255 (Part 1)"
  },
  {
   "code": "S-SO2",
   "name": "Sulphur dioxide in stack gases",
   "standardRef": "IS 11255 (Part 2)"
  },
  {
   "code": "S-NOX",
   "name": "Oxides of nitrogen in stack gases",
   "standardRef": "USEPA Method 7"
  },
  {
   "code": "S-CO",
   "name": "Carbon monoxide in stack gases, NDIR",
   "standardRef": "USEPA Method 10"
  },
  {
   "code": "SO-PH",
   "name": "Soil pH, electrometric",
   "standardRef": "IS 2720 (Part 26)"
  },
  {
   "code": "SO-EC",
   "name": "Electrical conductivity of soil",
   "standardRef": "IS 14767"
  },
  {
   "code": "SO-MOIST",
   "name": "Water content, oven drying",
   "standardRef": "IS 2720 (Part 2)"
  },
  {
   "code": "SO-OC",
   "name": "Organic carbon, Walkley and Black",
   "standardRef": "IS 2720 (Part 22)"
  },
  {
   "code": "SO-GRAIN",
   "name": "Grain size analysis",
   "standardRef": "IS 2720 (Part 4)"
  },
  {
   "code": "SO-BD",
   "name": "Bulk density, core method",
   "standardRef": null
  },
  {
   "code": "SO-CEC",
   "name": "Cation exchange capacity",
   "standardRef": "IS 2720 (Part 24)"
  },
  {
   "code": "SO-AVN",
   "name": "Available nitrogen, alkaline permanganate",
   "standardRef": "Subbiah and Asija"
  },
  {
   "code": "SO-AVP",
   "name": "Available phosphorus, sodium bicarbonate extraction",
   "standardRef": "Olsen"
  },
  {
   "code": "SO-AVK",
   "name": "Available potassium, neutral ammonium acetate extraction, flame photometry",
   "standardRef": null
  },
  {
   "code": "SO-METALS",
   "name": "Metals, acid digestion and ICP-OES",
   "standardRef": "USEPA 3050B and USEPA 6010"
  },
  {
   "code": "SO-TCLP",
   "name": "Toxicity characteristic leaching procedure, leachate metals by ICP-OES",
   "standardRef": "USEPA 1311 and USEPA 6010"
  },
  {
   "code": "N-AMB",
   "name": "Ambient noise, integrating sound level meter, A-weighted Leq",
   "standardRef": "Noise Pollution (Regulation and Control) Rules, 2000"
  },
  {
   "code": "N-WORK",
   "name": "Workplace noise, integrating sound level meter, A-weighted Leq",
   "standardRef": null
  },
  {
   "code": "MT-TENS",
   "name": "Tensile testing of metallic materials",
   "standardRef": "IS 1608 (Part 1) / ASTM E8/E8M"
  },
  {
   "code": "MT-IMPACT",
   "name": "Charpy pendulum impact test",
   "standardRef": "IS 1757 (Part 1) / ASTM E23"
  },
  {
   "code": "MT-BHN",
   "name": "Brinell hardness test",
   "standardRef": "IS 1500 (Part 1) / ASTM E10"
  },
  {
   "code": "MT-HRC",
   "name": "Rockwell hardness test",
   "standardRef": "IS 1586 (Part 1) / ASTM E18"
  },
  {
   "code": "MT-HV",
   "name": "Vickers hardness test",
   "standardRef": "IS 1501 (Part 1) / ASTM E92"
  },
  {
   "code": "MT-BEND",
   "name": "Bend test",
   "standardRef": "IS 1599 / ASTM E290"
  },
  {
   "code": "MT-OES-LAS",
   "name": "Optical emission spectrometry, carbon and low-alloy steel",
   "standardRef": "ASTM E415"
  },
  {
   "code": "MT-OES-SS",
   "name": "Optical emission spectrometry, austenitic stainless steel",
   "standardRef": "ASTM E1086"
  },
  {
   "code": "MT-MICRO",
   "name": "Microstructure: preparation and etching",
   "standardRef": "ASTM E3 / ASTM E407"
  },
  {
   "code": "MT-GRAIN",
   "name": "Average grain size",
   "standardRef": "ASTM E112"
  },
  {
   "code": "MT-INCL",
   "name": "Inclusion content",
   "standardRef": "ASTM E45"
  },
  {
   "code": "MT-COAT",
   "name": "Coating thickness, magnetic method",
   "standardRef": "ISO 2178"
  },
  {
   "code": "MT-ZNMASS",
   "name": "Mass of zinc coating",
   "standardRef": "IS 6745 / ASTM A90"
  },
  {
   "code": "MT-SALT",
   "name": "Neutral salt spray test",
   "standardRef": "ASTM B117"
  }
 ],
 "tests": [
  {
   "code": "WTR-PH",
   "name": "pH value",
   "category": "PHYSICAL",
   "department": "WTR",
   "method": "W-PH",
   "parameters": [
    {
     "code": "PH",
     "name": "pH value",
     "kind": "NUMERIC",
     "unit": null,
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-TEMP",
   "name": "Temperature",
   "category": "PHYSICAL",
   "department": "WTR",
   "method": "W-TEMP",
   "parameters": [
    {
     "code": "TEMP",
     "name": "Temperature",
     "kind": "NUMERIC",
     "unit": "CEL",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-TURB",
   "name": "Turbidity",
   "category": "PHYSICAL",
   "department": "WTR",
   "method": "W-TURB",
   "parameters": [
    {
     "code": "TURB",
     "name": "Turbidity",
     "kind": "NUMERIC",
     "unit": "NTU",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-COLOUR",
   "name": "Colour",
   "category": "PHYSICAL",
   "department": "WTR",
   "method": "W-COLOUR",
   "parameters": [
    {
     "code": "COLOUR",
     "name": "Colour",
     "kind": "NUMERIC",
     "unit": "HAZEN",
     "decimals": 0
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-ODOUR",
   "name": "Odour",
   "category": "PHYSICAL",
   "department": "WTR",
   "method": "W-ODOUR",
   "parameters": [
    {
     "code": "ODOUR",
     "name": "Odour",
     "kind": "RESULT_SET",
     "resultSet": "AGREEABLE",
     "decimals": 0
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-TASTE",
   "name": "Taste",
   "category": "PHYSICAL",
   "department": "WTR",
   "method": "W-TASTE",
   "parameters": [
    {
     "code": "TASTE",
     "name": "Taste",
     "kind": "RESULT_SET",
     "resultSet": "AGREEABLE",
     "decimals": 0
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-EC",
   "name": "Electrical conductivity",
   "category": "PHYSICAL",
   "department": "WTR",
   "method": "W-EC",
   "parameters": [
    {
     "code": "EC",
     "name": "Electrical conductivity",
     "kind": "NUMERIC",
     "unit": "US_CM",
     "decimals": 0
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-TDS",
   "name": "Total dissolved solids",
   "category": "PHYSICAL",
   "department": "WTR",
   "method": "W-TDS",
   "parameters": [
    {
     "code": "TDS",
     "name": "Total dissolved solids",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 0
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-TSS",
   "name": "Total suspended solids",
   "category": "PHYSICAL",
   "department": "WTR",
   "method": "W-TSS",
   "parameters": [
    {
     "code": "TSS",
     "name": "Total suspended solids",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 0
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-HARD",
   "name": "Total hardness (as CaCO3)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-HARD",
   "parameters": [
    {
     "code": "HARD",
     "name": "Total hardness (as CaCO3)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 0
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-CA",
   "name": "Calcium (as Ca)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-CA",
   "parameters": [
    {
     "code": "CA",
     "name": "Calcium (as Ca)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-MG",
   "name": "Magnesium (as Mg)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-MG",
   "parameters": [
    {
     "code": "MG",
     "name": "Magnesium (as Mg)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-ALK",
   "name": "Total alkalinity (as CaCO3)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-ALK",
   "parameters": [
    {
     "code": "ALK",
     "name": "Total alkalinity (as CaCO3)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 0
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-CL",
   "name": "Chloride (as Cl)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-CL",
   "parameters": [
    {
     "code": "CL",
     "name": "Chloride (as Cl)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 0
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-SO4",
   "name": "Sulphate (as SO4)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-SO4",
   "parameters": [
    {
     "code": "SO4",
     "name": "Sulphate (as SO4)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-NO3",
   "name": "Nitrate (as NO3)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-N",
   "parameters": [
    {
     "code": "NO3",
     "name": "Nitrate (as NO3)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-NO3N",
   "name": "Nitrate nitrogen (as N)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-N",
   "parameters": [
    {
     "code": "NO3N",
     "name": "Nitrate nitrogen (as N)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-NO2",
   "name": "Nitrite (as NO2)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-NO2",
   "parameters": [
    {
     "code": "NO2",
     "name": "Nitrite (as NO2)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-F",
   "name": "Fluoride (as F)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-F",
   "parameters": [
    {
     "code": "F",
     "name": "Fluoride (as F)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-NH3N",
   "name": "Ammoniacal nitrogen (as N)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-N",
   "parameters": [
    {
     "code": "NH3N",
     "name": "Ammoniacal nitrogen (as N)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-FNH3",
   "name": "Free ammonia (as NH3)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-N",
   "parameters": [
    {
     "code": "FNH3",
     "name": "Free ammonia (as NH3)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-TKN",
   "name": "Total Kjeldahl nitrogen (as NH3)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-N",
   "parameters": [
    {
     "code": "TKN",
     "name": "Total Kjeldahl nitrogen (as NH3)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-PO4",
   "name": "Dissolved phosphate (as P)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-PO4",
   "parameters": [
    {
     "code": "PO4",
     "name": "Dissolved phosphate (as P)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-NA",
   "name": "Sodium (as Na)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-NAK",
   "parameters": [
    {
     "code": "NA",
     "name": "Sodium (as Na)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-K",
   "name": "Potassium (as K)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-NAK",
   "parameters": [
    {
     "code": "K",
     "name": "Potassium (as K)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-FRC",
   "name": "Free residual chlorine",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-CL2",
   "parameters": [
    {
     "code": "FRC",
     "name": "Free residual chlorine",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-TRC",
   "name": "Total residual chlorine",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-CL2",
   "parameters": [
    {
     "code": "TRC",
     "name": "Total residual chlorine",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-CHLORAM",
   "name": "Chloramines (as Cl2)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-CL2",
   "parameters": [
    {
     "code": "CHLORAM",
     "name": "Chloramines (as Cl2)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-DO",
   "name": "Dissolved oxygen",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-DO",
   "parameters": [
    {
     "code": "DO",
     "name": "Dissolved oxygen",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-BOD",
   "name": "Biochemical oxygen demand (3 days at 27 °C)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-BOD",
   "parameters": [
    {
     "code": "BOD",
     "name": "Biochemical oxygen demand (3 days at 27 °C)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-COD",
   "name": "Chemical oxygen demand",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-COD",
   "parameters": [
    {
     "code": "COD",
     "name": "Chemical oxygen demand",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 0
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-OG",
   "name": "Oil and grease",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-OG",
   "parameters": [
    {
     "code": "OG",
     "name": "Oil and grease",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-MINOIL",
   "name": "Mineral oil",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-MINOIL",
   "parameters": [
    {
     "code": "MINOIL",
     "name": "Mineral oil",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-PHENOL",
   "name": "Phenolic compounds (as C6H5OH)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-PHENOL",
   "parameters": [
    {
     "code": "PHENOL",
     "name": "Phenolic compounds (as C6H5OH)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 4
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-CN",
   "name": "Cyanide (as CN)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-CN",
   "parameters": [
    {
     "code": "CN",
     "name": "Cyanide (as CN)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-S",
   "name": "Sulphide (as S)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-S",
   "parameters": [
    {
     "code": "S",
     "name": "Sulphide (as S)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-MBAS",
   "name": "Anionic detergents (as MBAS)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-MBAS",
   "parameters": [
    {
     "code": "MBAS",
     "name": "Anionic detergents (as MBAS)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-AL",
   "name": "Aluminium (as Al)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-AL",
   "parameters": [
    {
     "code": "AL",
     "name": "Aluminium (as Al)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-AS",
   "name": "Arsenic (as As)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-AS",
   "parameters": [
    {
     "code": "AS",
     "name": "Arsenic (as As)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-B",
   "name": "Boron (as B)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-B",
   "parameters": [
    {
     "code": "B",
     "name": "Boron (as B)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-BA",
   "name": "Barium (as Ba)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-BA",
   "parameters": [
    {
     "code": "BA",
     "name": "Barium (as Ba)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-CD",
   "name": "Cadmium (as Cd)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-CD",
   "parameters": [
    {
     "code": "CD",
     "name": "Cadmium (as Cd)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 4
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-CR",
   "name": "Total chromium (as Cr)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-CR",
   "parameters": [
    {
     "code": "CR",
     "name": "Total chromium (as Cr)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-CR6",
   "name": "Hexavalent chromium (as Cr6+)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-CR6",
   "parameters": [
    {
     "code": "CR6",
     "name": "Hexavalent chromium (as Cr6+)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-CU",
   "name": "Copper (as Cu)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-CU",
   "parameters": [
    {
     "code": "CU",
     "name": "Copper (as Cu)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-FE",
   "name": "Iron (as Fe)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-FE",
   "parameters": [
    {
     "code": "FE",
     "name": "Iron (as Fe)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-HG",
   "name": "Mercury (as Hg)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-HG",
   "parameters": [
    {
     "code": "HG",
     "name": "Mercury (as Hg)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 4
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-MN",
   "name": "Manganese (as Mn)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-MN",
   "parameters": [
    {
     "code": "MN",
     "name": "Manganese (as Mn)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-MO",
   "name": "Molybdenum (as Mo)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-MO",
   "parameters": [
    {
     "code": "MO",
     "name": "Molybdenum (as Mo)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-NI",
   "name": "Nickel (as Ni)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-NI",
   "parameters": [
    {
     "code": "NI",
     "name": "Nickel (as Ni)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-PB",
   "name": "Lead (as Pb)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-PB",
   "parameters": [
    {
     "code": "PB",
     "name": "Lead (as Pb)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-SE",
   "name": "Selenium (as Se)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-SE",
   "parameters": [
    {
     "code": "SE",
     "name": "Selenium (as Se)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-AG",
   "name": "Silver (as Ag)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-AG",
   "parameters": [
    {
     "code": "AG",
     "name": "Silver (as Ag)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-V",
   "name": "Vanadium (as V)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-V",
   "parameters": [
    {
     "code": "V",
     "name": "Vanadium (as V)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "WTR-ZN",
   "name": "Zinc (as Zn)",
   "category": "CHEMICAL",
   "department": "WTR",
   "method": "W-ZN",
   "parameters": [
    {
     "code": "ZN",
     "name": "Zinc (as Zn)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MIC-TC",
   "name": "Total coliform bacteria",
   "category": "OTHER",
   "department": "MICRO",
   "method": "MB-MF",
   "parameters": [
    {
     "code": "TC",
     "name": "Total coliform bacteria (in 100 mL)",
     "kind": "RESULT_SET",
     "resultSet": "DETECTED",
     "decimals": 0
    }
   ],
   "defaultTatDays": 3,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MIC-ECOLI",
   "name": "E. coli",
   "category": "OTHER",
   "department": "MICRO",
   "method": "MB-MF",
   "parameters": [
    {
     "code": "ECOLI",
     "name": "E. coli (in 100 mL)",
     "kind": "RESULT_SET",
     "resultSet": "DETECTED",
     "decimals": 0
    }
   ],
   "defaultTatDays": 3,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MIC-TC-MPN",
   "name": "Total coliform (MPN)",
   "category": "OTHER",
   "department": "MICRO",
   "method": "MB-TC-MPN",
   "parameters": [
    {
     "code": "TC_MPN",
     "name": "Total coliform",
     "kind": "NUMERIC",
     "unit": "MPN_100ML",
     "decimals": 0
    }
   ],
   "defaultTatDays": 4,
   "urgentTatDays": 3,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MIC-FC-MPN",
   "name": "Faecal coliform (MPN)",
   "category": "OTHER",
   "department": "MICRO",
   "method": "MB-FC-MPN",
   "parameters": [
    {
     "code": "FC_MPN",
     "name": "Faecal coliform",
     "kind": "NUMERIC",
     "unit": "MPN_100ML",
     "decimals": 0
    }
   ],
   "defaultTatDays": 4,
   "urgentTatDays": 3,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "AAQ-PM10",
   "name": "Particulate matter PM10",
   "category": "PHYSICAL",
   "department": "AIR",
   "method": "A-PM10",
   "parameters": [
    {
     "code": "PM10",
     "name": "PM10",
     "kind": "NUMERIC",
     "unit": "UG_M3",
     "decimals": 0
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "AAQ-PM25",
   "name": "Particulate matter PM2.5",
   "category": "PHYSICAL",
   "department": "AIR",
   "method": "A-PM25",
   "parameters": [
    {
     "code": "PM25",
     "name": "PM2.5",
     "kind": "NUMERIC",
     "unit": "UG_M3",
     "decimals": 0
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "AAQ-SO2",
   "name": "Sulphur dioxide (SO2), ambient",
   "category": "CHEMICAL",
   "department": "AIR",
   "method": "A-SO2",
   "parameters": [
    {
     "code": "SO2",
     "name": "Sulphur dioxide (SO2)",
     "kind": "NUMERIC",
     "unit": "UG_M3",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "AAQ-NO2",
   "name": "Nitrogen dioxide (NO2), ambient",
   "category": "CHEMICAL",
   "department": "AIR",
   "method": "A-NO2",
   "parameters": [
    {
     "code": "NO2",
     "name": "Nitrogen dioxide (NO2)",
     "kind": "NUMERIC",
     "unit": "UG_M3",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "AAQ-CO",
   "name": "Carbon monoxide (CO), ambient",
   "category": "CHEMICAL",
   "department": "AIR",
   "method": "A-CO",
   "parameters": [
    {
     "code": "CO",
     "name": "Carbon monoxide (CO)",
     "kind": "NUMERIC",
     "unit": "MG_M3",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "AAQ-O3",
   "name": "Ozone (O3), ambient",
   "category": "CHEMICAL",
   "department": "AIR",
   "method": "A-O3",
   "parameters": [
    {
     "code": "O3",
     "name": "Ozone (O3)",
     "kind": "NUMERIC",
     "unit": "UG_M3",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "AAQ-NH3",
   "name": "Ammonia (NH3), ambient",
   "category": "CHEMICAL",
   "department": "AIR",
   "method": "A-NH3",
   "parameters": [
    {
     "code": "NH3",
     "name": "Ammonia (NH3)",
     "kind": "NUMERIC",
     "unit": "UG_M3",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "AAQ-PB",
   "name": "Lead (Pb), ambient",
   "category": "CHEMICAL",
   "department": "AIR",
   "method": "A-METALS",
   "parameters": [
    {
     "code": "PB",
     "name": "Lead (Pb)",
     "kind": "NUMERIC",
     "unit": "UG_M3",
     "decimals": 3
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "AAQ-NI",
   "name": "Nickel (Ni), ambient",
   "category": "CHEMICAL",
   "department": "AIR",
   "method": "A-METALS",
   "parameters": [
    {
     "code": "NI",
     "name": "Nickel (Ni)",
     "kind": "NUMERIC",
     "unit": "NG_M3",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "AAQ-AS",
   "name": "Arsenic (As), ambient",
   "category": "CHEMICAL",
   "department": "AIR",
   "method": "A-METALS",
   "parameters": [
    {
     "code": "AS",
     "name": "Arsenic (As)",
     "kind": "NUMERIC",
     "unit": "NG_M3",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "AAQ-C6H6",
   "name": "Benzene (C6H6), ambient",
   "category": "CHEMICAL",
   "department": "AIR",
   "method": "A-C6H6",
   "parameters": [
    {
     "code": "C6H6",
     "name": "Benzene (C6H6)",
     "kind": "NUMERIC",
     "unit": "UG_M3",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "AAQ-BAP",
   "name": "Benzo(a)pyrene (BaP), particulate phase",
   "category": "CHEMICAL",
   "department": "AIR",
   "method": "A-BAP",
   "parameters": [
    {
     "code": "BAP",
     "name": "Benzo(a)pyrene (BaP)",
     "kind": "NUMERIC",
     "unit": "NG_M3",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "STK-FLOW",
   "name": "Stack gas temperature, velocity and flow rate",
   "category": "PHYSICAL",
   "department": "AIR",
   "method": "S-VEL",
   "parameters": [
    {
     "code": "TEMP",
     "name": "Stack gas temperature",
     "kind": "NUMERIC",
     "unit": "CEL",
     "decimals": 0
    },
    {
     "code": "VEL",
     "name": "Stack gas velocity",
     "kind": "NUMERIC",
     "unit": "M_S",
     "decimals": 2
    },
    {
     "code": "FLOW",
     "name": "Volumetric flow rate",
     "kind": "NUMERIC",
     "unit": "NM3_H",
     "decimals": 0
    }
   ],
   "defaultTatDays": 7,
   "urgentTatDays": 3,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "STK-GAS",
   "name": "Oxygen and carbon dioxide in stack gas",
   "category": "CHEMICAL",
   "department": "AIR",
   "method": "S-GAS",
   "parameters": [
    {
     "code": "O2",
     "name": "Oxygen (O2)",
     "kind": "NUMERIC",
     "unit": "PCT_VOL",
     "decimals": 1
    },
    {
     "code": "CO2",
     "name": "Carbon dioxide (CO2)",
     "kind": "NUMERIC",
     "unit": "PCT_VOL",
     "decimals": 1
    }
   ],
   "defaultTatDays": 7,
   "urgentTatDays": 3,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "STK-MOIST",
   "name": "Moisture in stack gas",
   "category": "PHYSICAL",
   "department": "AIR",
   "method": "S-MOIST",
   "parameters": [
    {
     "code": "MOIST",
     "name": "Moisture",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 1
    }
   ],
   "defaultTatDays": 7,
   "urgentTatDays": 3,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "STK-PM",
   "name": "Particulate matter in stack emission",
   "category": "PHYSICAL",
   "department": "AIR",
   "method": "S-PM",
   "parameters": [
    {
     "code": "PM",
     "name": "Particulate matter",
     "kind": "NUMERIC",
     "unit": "MG_NM3",
     "decimals": 1
    }
   ],
   "defaultTatDays": 7,
   "urgentTatDays": 3,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "STK-SO2",
   "name": "Sulphur dioxide in stack emission",
   "category": "CHEMICAL",
   "department": "AIR",
   "method": "S-SO2",
   "parameters": [
    {
     "code": "SO2",
     "name": "Sulphur dioxide (SO2)",
     "kind": "NUMERIC",
     "unit": "MG_NM3",
     "decimals": 1
    }
   ],
   "defaultTatDays": 7,
   "urgentTatDays": 3,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "STK-NOX",
   "name": "Oxides of nitrogen in stack emission",
   "category": "CHEMICAL",
   "department": "AIR",
   "method": "S-NOX",
   "parameters": [
    {
     "code": "NOX",
     "name": "Oxides of nitrogen (as NO2)",
     "kind": "NUMERIC",
     "unit": "MG_NM3",
     "decimals": 1
    }
   ],
   "defaultTatDays": 7,
   "urgentTatDays": 3,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "STK-CO",
   "name": "Carbon monoxide in stack emission",
   "category": "CHEMICAL",
   "department": "AIR",
   "method": "S-CO",
   "parameters": [
    {
     "code": "CO",
     "name": "Carbon monoxide (CO)",
     "kind": "NUMERIC",
     "unit": "MG_NM3",
     "decimals": 1
    }
   ],
   "defaultTatDays": 7,
   "urgentTatDays": 3,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "SOIL-PH",
   "name": "pH, soil and sludge",
   "category": "PHYSICAL",
   "department": "SOIL",
   "method": "SO-PH",
   "parameters": [
    {
     "code": "PH",
     "name": "pH value",
     "kind": "NUMERIC",
     "unit": null,
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "SOIL-EC",
   "name": "Electrical conductivity, soil and sludge",
   "category": "PHYSICAL",
   "department": "SOIL",
   "method": "SO-EC",
   "parameters": [
    {
     "code": "EC",
     "name": "Electrical conductivity",
     "kind": "NUMERIC",
     "unit": "US_CM",
     "decimals": 0
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "SOIL-MOIST",
   "name": "Moisture content, soil and sludge",
   "category": "PHYSICAL",
   "department": "SOIL",
   "method": "SO-MOIST",
   "parameters": [
    {
     "code": "MOIST",
     "name": "Moisture content",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "SOIL-OC",
   "name": "Organic carbon, soil",
   "category": "CHEMICAL",
   "department": "SOIL",
   "method": "SO-OC",
   "parameters": [
    {
     "code": "OC",
     "name": "Organic carbon",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "SOIL-TEXT",
   "name": "Soil texture (particle size)",
   "category": "PHYSICAL",
   "department": "SOIL",
   "method": "SO-GRAIN",
   "parameters": [
    {
     "code": "SAND",
     "name": "Sand",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 1
    },
    {
     "code": "SILT",
     "name": "Silt",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 1
    },
    {
     "code": "CLAY",
     "name": "Clay",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "SOIL-BD",
   "name": "Bulk density, soil",
   "category": "PHYSICAL",
   "department": "SOIL",
   "method": "SO-BD",
   "parameters": [
    {
     "code": "BD",
     "name": "Bulk density",
     "kind": "NUMERIC",
     "unit": "GCM3",
     "decimals": 2
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "SOIL-CEC",
   "name": "Cation exchange capacity, soil",
   "category": "CHEMICAL",
   "department": "SOIL",
   "method": "SO-CEC",
   "parameters": [
    {
     "code": "CEC",
     "name": "Cation exchange capacity",
     "kind": "NUMERIC",
     "unit": "MEQ_100G",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "SOIL-N",
   "name": "Available nitrogen, soil",
   "category": "CHEMICAL",
   "department": "SOIL",
   "method": "SO-AVN",
   "parameters": [
    {
     "code": "N",
     "name": "Available nitrogen (as N)",
     "kind": "NUMERIC",
     "unit": "KG_HA",
     "decimals": 0
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "SOIL-P",
   "name": "Available phosphorus, soil",
   "category": "CHEMICAL",
   "department": "SOIL",
   "method": "SO-AVP",
   "parameters": [
    {
     "code": "P",
     "name": "Available phosphorus (as P)",
     "kind": "NUMERIC",
     "unit": "KG_HA",
     "decimals": 1
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "SOIL-K",
   "name": "Available potassium, soil",
   "category": "CHEMICAL",
   "department": "SOIL",
   "method": "SO-AVK",
   "parameters": [
    {
     "code": "K",
     "name": "Available potassium (as K)",
     "kind": "NUMERIC",
     "unit": "KG_HA",
     "decimals": 0
    }
   ],
   "defaultTatDays": 5,
   "urgentTatDays": 2,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "SOIL-METALS",
   "name": "Heavy metals, soil and sludge",
   "category": "CHEMICAL",
   "department": "SOIL",
   "method": "SO-METALS",
   "parameters": [
    {
     "code": "PB",
     "name": "Lead (as Pb)",
     "kind": "NUMERIC",
     "unit": "MG_KG",
     "decimals": 2
    },
    {
     "code": "CD",
     "name": "Cadmium (as Cd)",
     "kind": "NUMERIC",
     "unit": "MG_KG",
     "decimals": 2
    },
    {
     "code": "CR",
     "name": "Total chromium (as Cr)",
     "kind": "NUMERIC",
     "unit": "MG_KG",
     "decimals": 2
    },
    {
     "code": "CU",
     "name": "Copper (as Cu)",
     "kind": "NUMERIC",
     "unit": "MG_KG",
     "decimals": 2
    },
    {
     "code": "ZN",
     "name": "Zinc (as Zn)",
     "kind": "NUMERIC",
     "unit": "MG_KG",
     "decimals": 2
    },
    {
     "code": "NI",
     "name": "Nickel (as Ni)",
     "kind": "NUMERIC",
     "unit": "MG_KG",
     "decimals": 2
    },
    {
     "code": "AS",
     "name": "Arsenic (as As)",
     "kind": "NUMERIC",
     "unit": "MG_KG",
     "decimals": 2
    },
    {
     "code": "HG",
     "name": "Mercury (as Hg)",
     "kind": "NUMERIC",
     "unit": "MG_KG",
     "decimals": 3
    },
    {
     "code": "FE",
     "name": "Iron (as Fe)",
     "kind": "NUMERIC",
     "unit": "MG_KG",
     "decimals": 1
    },
    {
     "code": "MN",
     "name": "Manganese (as Mn)",
     "kind": "NUMERIC",
     "unit": "MG_KG",
     "decimals": 1
    }
   ],
   "defaultTatDays": 7,
   "urgentTatDays": 3,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "SLDG-TCLP",
   "name": "TCLP leachate metals, sludge and solid waste",
   "category": "CHEMICAL",
   "department": "SOIL",
   "method": "SO-TCLP",
   "parameters": [
    {
     "code": "PB",
     "name": "Lead (as Pb)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    },
    {
     "code": "CD",
     "name": "Cadmium (as Cd)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    },
    {
     "code": "CR",
     "name": "Total chromium (as Cr)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    },
    {
     "code": "AS",
     "name": "Arsenic (as As)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    },
    {
     "code": "HG",
     "name": "Mercury (as Hg)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 4
    },
    {
     "code": "NI",
     "name": "Nickel (as Ni)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    },
    {
     "code": "ZN",
     "name": "Zinc (as Zn)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    },
    {
     "code": "CU",
     "name": "Copper (as Cu)",
     "kind": "NUMERIC",
     "unit": "MG_L",
     "decimals": 3
    }
   ],
   "defaultTatDays": 7,
   "urgentTatDays": 4,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "NOISE-AMB",
   "name": "Ambient noise level (day and night)",
   "category": "PHYSICAL",
   "department": "NOISE",
   "method": "N-AMB",
   "parameters": [
    {
     "code": "LEQ_DAY",
     "name": "Leq, day time (6 am – 10 pm)",
     "kind": "NUMERIC",
     "unit": "DBA",
     "decimals": 1
    },
    {
     "code": "LEQ_NIGHT",
     "name": "Leq, night time (10 pm – 6 am)",
     "kind": "NUMERIC",
     "unit": "DBA",
     "decimals": 1
    },
    {
     "code": "LMAX",
     "name": "Lmax",
     "kind": "NUMERIC",
     "unit": "DBA",
     "decimals": 1
    },
    {
     "code": "LMIN",
     "name": "Lmin",
     "kind": "NUMERIC",
     "unit": "DBA",
     "decimals": 1
    }
   ],
   "defaultTatDays": 3,
   "urgentTatDays": 2,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "NOISE-WORK",
   "name": "Workplace noise level",
   "category": "PHYSICAL",
   "department": "NOISE",
   "method": "N-WORK",
   "parameters": [
    {
     "code": "LEQ",
     "name": "Leq, monitoring period",
     "kind": "NUMERIC",
     "unit": "DBA",
     "decimals": 1
    },
    {
     "code": "LMAX",
     "name": "Lmax",
     "kind": "NUMERIC",
     "unit": "DBA",
     "decimals": 1
    }
   ],
   "defaultTatDays": 3,
   "urgentTatDays": 2,
   "stages": [
    "Site Monitoring",
    "Sample Received by Analyst",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MT-TENS",
   "name": "Tensile test, flat specimen",
   "category": "MECHANICAL",
   "department": "MECH",
   "method": "MT-TENS",
   "parameters": [
    {
     "code": "WIDTH",
     "name": "Width",
     "kind": "NUMERIC",
     "unit": "MM",
     "decimals": 2
    },
    {
     "code": "THICK",
     "name": "Thickness",
     "kind": "NUMERIC",
     "unit": "MM",
     "decimals": 2
    },
    {
     "code": "A0",
     "name": "Original area",
     "kind": "CALCULATED",
     "unit": "MM2",
     "decimals": 3,
     "formula": "AREA_RECT",
     "bindings": {
      "width": "WIDTH",
      "thickness": "THICK"
     }
    },
    {
     "code": "Af",
     "name": "Final area",
     "kind": "NUMERIC",
     "unit": "MM2",
     "decimals": 3
    },
    {
     "code": "LOAD",
     "name": "Maximum load",
     "kind": "NUMERIC",
     "unit": "N",
     "decimals": 0
    },
    {
     "code": "PROOFLOAD",
     "name": "Load at proof",
     "kind": "NUMERIC",
     "unit": "N",
     "decimals": 0
    },
    {
     "code": "L0",
     "name": "Original gauge length",
     "kind": "NUMERIC",
     "unit": "MM",
     "decimals": 2
    },
    {
     "code": "Lf",
     "name": "Final gauge length",
     "kind": "NUMERIC",
     "unit": "MM",
     "decimals": 2
    },
    {
     "code": "UTS",
     "name": "Ultimate tensile strength",
     "kind": "CALCULATED",
     "unit": "MPA",
     "decimals": 2,
     "formula": "UTS",
     "bindings": {
      "max_load": "LOAD",
      "original_area": "A0"
     }
    },
    {
     "code": "PROOF",
     "name": "0.2% proof stress",
     "kind": "CALCULATED",
     "unit": "MPA",
     "decimals": 2,
     "formula": "PROOF",
     "bindings": {
      "load_at_proof": "PROOFLOAD",
      "original_area": "A0"
     }
    },
    {
     "code": "ROA",
     "name": "Reduction of area",
     "kind": "CALCULATED",
     "unit": "PCT",
     "decimals": 2,
     "formula": "ROA",
     "bindings": {
      "A0": "A0",
      "Af": "Af"
     }
    },
    {
     "code": "EL",
     "name": "Elongation",
     "kind": "CALCULATED",
     "unit": "PCT",
     "decimals": 2,
     "formula": "ELONGATION",
     "bindings": {
      "L0": "L0",
      "Lf": "Lf"
     }
    }
   ],
   "defaultTatDays": 3,
   "urgentTatDays": 1,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MT-TENS-RD",
   "name": "Tensile test, round specimen",
   "category": "MECHANICAL",
   "department": "MECH",
   "method": "MT-TENS",
   "parameters": [
    {
     "code": "DIA",
     "name": "Diameter",
     "kind": "NUMERIC",
     "unit": "MM",
     "decimals": 2
    },
    {
     "code": "A0",
     "name": "Original area",
     "kind": "CALCULATED",
     "unit": "MM2",
     "decimals": 3,
     "formula": "AREA_ROUND",
     "bindings": {
      "d": "DIA"
     }
    },
    {
     "code": "Af",
     "name": "Final area",
     "kind": "NUMERIC",
     "unit": "MM2",
     "decimals": 3
    },
    {
     "code": "LOAD",
     "name": "Maximum load",
     "kind": "NUMERIC",
     "unit": "N",
     "decimals": 0
    },
    {
     "code": "PROOFLOAD",
     "name": "Load at proof",
     "kind": "NUMERIC",
     "unit": "N",
     "decimals": 0
    },
    {
     "code": "L0",
     "name": "Original gauge length",
     "kind": "NUMERIC",
     "unit": "MM",
     "decimals": 2
    },
    {
     "code": "Lf",
     "name": "Final gauge length",
     "kind": "NUMERIC",
     "unit": "MM",
     "decimals": 2
    },
    {
     "code": "UTS",
     "name": "Ultimate tensile strength",
     "kind": "CALCULATED",
     "unit": "MPA",
     "decimals": 2,
     "formula": "UTS",
     "bindings": {
      "max_load": "LOAD",
      "original_area": "A0"
     }
    },
    {
     "code": "PROOF",
     "name": "0.2% proof stress",
     "kind": "CALCULATED",
     "unit": "MPA",
     "decimals": 2,
     "formula": "PROOF",
     "bindings": {
      "load_at_proof": "PROOFLOAD",
      "original_area": "A0"
     }
    },
    {
     "code": "ROA",
     "name": "Reduction of area",
     "kind": "CALCULATED",
     "unit": "PCT",
     "decimals": 2,
     "formula": "ROA",
     "bindings": {
      "A0": "A0",
      "Af": "Af"
     }
    },
    {
     "code": "EL",
     "name": "Elongation",
     "kind": "CALCULATED",
     "unit": "PCT",
     "decimals": 2,
     "formula": "ELONGATION",
     "bindings": {
      "L0": "L0",
      "Lf": "Lf"
     }
    }
   ],
   "defaultTatDays": 3,
   "urgentTatDays": 1,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MT-IMPACT",
   "name": "Charpy impact test",
   "category": "MECHANICAL",
   "department": "MECH",
   "method": "MT-IMPACT",
   "parameters": [
    {
     "code": "a",
     "name": "Impact energy 1",
     "kind": "NUMERIC",
     "unit": "J",
     "decimals": 1
    },
    {
     "code": "b",
     "name": "Impact energy 2",
     "kind": "NUMERIC",
     "unit": "J",
     "decimals": 1
    },
    {
     "code": "c",
     "name": "Impact energy 3",
     "kind": "NUMERIC",
     "unit": "J",
     "decimals": 1
    },
    {
     "code": "AVG",
     "name": "Average impact energy",
     "kind": "CALCULATED",
     "unit": "J",
     "decimals": 1,
     "formula": "AVERAGE3",
     "bindings": {
      "a": "a",
      "b": "b",
      "c": "c"
     }
    }
   ],
   "defaultTatDays": 3,
   "urgentTatDays": 1,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MT-BHN",
   "name": "Brinell hardness",
   "category": "MECHANICAL",
   "department": "MECH",
   "method": "MT-BHN",
   "parameters": [
    {
     "code": "R1",
     "name": "Reading 1",
     "kind": "NUMERIC",
     "unit": "HBW",
     "decimals": 0
    },
    {
     "code": "R2",
     "name": "Reading 2",
     "kind": "NUMERIC",
     "unit": "HBW",
     "decimals": 0
    },
    {
     "code": "R3",
     "name": "Reading 3",
     "kind": "NUMERIC",
     "unit": "HBW",
     "decimals": 0
    },
    {
     "code": "AVG",
     "name": "Average hardness",
     "kind": "CALCULATED",
     "unit": "HBW",
     "decimals": 0,
     "formula": "AVERAGE3",
     "bindings": {
      "a": "R1",
      "b": "R2",
      "c": "R3"
     }
    }
   ],
   "defaultTatDays": 2,
   "urgentTatDays": 1,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MT-HRC",
   "name": "Rockwell hardness (C scale)",
   "category": "MECHANICAL",
   "department": "MECH",
   "method": "MT-HRC",
   "parameters": [
    {
     "code": "R1",
     "name": "Reading 1",
     "kind": "NUMERIC",
     "unit": "HRC",
     "decimals": 1
    },
    {
     "code": "R2",
     "name": "Reading 2",
     "kind": "NUMERIC",
     "unit": "HRC",
     "decimals": 1
    },
    {
     "code": "R3",
     "name": "Reading 3",
     "kind": "NUMERIC",
     "unit": "HRC",
     "decimals": 1
    },
    {
     "code": "AVG",
     "name": "Average hardness",
     "kind": "CALCULATED",
     "unit": "HRC",
     "decimals": 1,
     "formula": "AVERAGE3",
     "bindings": {
      "a": "R1",
      "b": "R2",
      "c": "R3"
     }
    }
   ],
   "defaultTatDays": 2,
   "urgentTatDays": 1,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MT-HV",
   "name": "Vickers hardness",
   "category": "MECHANICAL",
   "department": "MECH",
   "method": "MT-HV",
   "parameters": [
    {
     "code": "R1",
     "name": "Reading 1",
     "kind": "NUMERIC",
     "unit": "HV",
     "decimals": 0
    },
    {
     "code": "R2",
     "name": "Reading 2",
     "kind": "NUMERIC",
     "unit": "HV",
     "decimals": 0
    },
    {
     "code": "R3",
     "name": "Reading 3",
     "kind": "NUMERIC",
     "unit": "HV",
     "decimals": 0
    },
    {
     "code": "AVG",
     "name": "Average hardness",
     "kind": "CALCULATED",
     "unit": "HV",
     "decimals": 0,
     "formula": "AVERAGE3",
     "bindings": {
      "a": "R1",
      "b": "R2",
      "c": "R3"
     }
    }
   ],
   "defaultTatDays": 2,
   "urgentTatDays": 1,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MT-BEND",
   "name": "Bend test",
   "category": "MECHANICAL",
   "department": "MECH",
   "method": "MT-BEND",
   "parameters": [
    {
     "code": "BEND",
     "name": "Bend test result",
     "kind": "RESULT_SET",
     "resultSet": "BEND",
     "decimals": 0
    }
   ],
   "defaultTatDays": 2,
   "urgentTatDays": 1,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MT-CHEM-LAS",
   "name": "Chemical analysis, carbon and low-alloy steel (OES)",
   "category": "CHEMICAL",
   "department": "METL",
   "method": "MT-OES-LAS",
   "parameters": [
    {
     "code": "C",
     "name": "Carbon (C)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "SI",
     "name": "Silicon (Si)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "MN",
     "name": "Manganese (Mn)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "P",
     "name": "Phosphorus (P)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "S",
     "name": "Sulphur (S)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "CR",
     "name": "Chromium (Cr)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "MO",
     "name": "Molybdenum (Mo)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "NI",
     "name": "Nickel (Ni)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "CU",
     "name": "Copper (Cu)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "V",
     "name": "Vanadium (V)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "AL",
     "name": "Aluminium (Al)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "CE",
     "name": "Carbon equivalent (IIW)",
     "kind": "CALCULATED",
     "unit": null,
     "decimals": 3,
     "formula": "CE_IIW",
     "bindings": {
      "C": "C",
      "Mn": "MN",
      "Cr": "CR",
      "Mo": "MO",
      "V": "V",
      "Ni": "NI",
      "Cu": "CU"
     }
    }
   ],
   "defaultTatDays": 2,
   "urgentTatDays": 1,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MT-CHEM-SS",
   "name": "Chemical analysis, austenitic stainless steel (OES)",
   "category": "CHEMICAL",
   "department": "METL",
   "method": "MT-OES-SS",
   "parameters": [
    {
     "code": "C",
     "name": "Carbon (C)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "SI",
     "name": "Silicon (Si)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "MN",
     "name": "Manganese (Mn)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "P",
     "name": "Phosphorus (P)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "S",
     "name": "Sulphur (S)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "CR",
     "name": "Chromium (Cr)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 2
    },
    {
     "code": "NI",
     "name": "Nickel (Ni)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 2
    },
    {
     "code": "MO",
     "name": "Molybdenum (Mo)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 2
    },
    {
     "code": "N",
     "name": "Nitrogen (N)",
     "kind": "NUMERIC",
     "unit": "PCT",
     "decimals": 3
    },
    {
     "code": "PREN",
     "name": "Pitting resistance equivalent number (PREN)",
     "kind": "CALCULATED",
     "unit": null,
     "decimals": 2,
     "formula": "PREN",
     "bindings": {
      "Cr": "CR",
      "Mo": "MO",
      "N": "N"
     }
    }
   ],
   "defaultTatDays": 2,
   "urgentTatDays": 1,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MT-MICRO",
   "name": "Microstructure examination",
   "category": "OTHER",
   "department": "METL",
   "method": "MT-MICRO",
   "parameters": [
    {
     "code": "MICRO",
     "name": "Microstructure",
     "kind": "TEXT",
     "decimals": 0
    }
   ],
   "defaultTatDays": 3,
   "urgentTatDays": 1,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MT-GRAIN",
   "name": "Average grain size",
   "category": "OTHER",
   "department": "METL",
   "method": "MT-GRAIN",
   "parameters": [
    {
     "code": "G",
     "name": "ASTM grain size number",
     "kind": "NUMERIC",
     "unit": null,
     "decimals": 1
    }
   ],
   "defaultTatDays": 3,
   "urgentTatDays": 1,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MT-INCL",
   "name": "Inclusion rating",
   "category": "OTHER",
   "department": "METL",
   "method": "MT-INCL",
   "parameters": [
    {
     "code": "INCL",
     "name": "Inclusion rating",
     "kind": "TEXT",
     "decimals": 0
    }
   ],
   "defaultTatDays": 3,
   "urgentTatDays": 1,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MT-COAT",
   "name": "Coating thickness",
   "category": "PHYSICAL",
   "department": "MECH",
   "method": "MT-COAT",
   "parameters": [
    {
     "code": "R1",
     "name": "Reading 1",
     "kind": "NUMERIC",
     "unit": "UM",
     "decimals": 1
    },
    {
     "code": "R2",
     "name": "Reading 2",
     "kind": "NUMERIC",
     "unit": "UM",
     "decimals": 1
    },
    {
     "code": "R3",
     "name": "Reading 3",
     "kind": "NUMERIC",
     "unit": "UM",
     "decimals": 1
    },
    {
     "code": "AVG",
     "name": "Average coating thickness",
     "kind": "CALCULATED",
     "unit": "UM",
     "decimals": 1,
     "formula": "AVERAGE3",
     "bindings": {
      "a": "R1",
      "b": "R2",
      "c": "R3"
     }
    }
   ],
   "defaultTatDays": 2,
   "urgentTatDays": 1,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MT-ZNMASS",
   "name": "Mass of zinc coating",
   "category": "CHEMICAL",
   "department": "METL",
   "method": "MT-ZNMASS",
   "parameters": [
    {
     "code": "ZN",
     "name": "Mass of zinc coating",
     "kind": "NUMERIC",
     "unit": "G_M2",
     "decimals": 0
    }
   ],
   "defaultTatDays": 2,
   "urgentTatDays": 1,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  },
  {
   "code": "MT-SALT",
   "name": "Neutral salt spray test",
   "category": "PHYSICAL",
   "department": "METL",
   "method": "MT-SALT",
   "parameters": [
    {
     "code": "HOURS",
     "name": "Exposure duration",
     "kind": "NUMERIC",
     "unit": "HOUR",
     "decimals": 0
    },
    {
     "code": "OBS",
     "name": "Observation after exposure",
     "kind": "TEXT",
     "decimals": 0
    }
   ],
   "defaultTatDays": 10,
   "urgentTatDays": 7,
   "stages": [
    "Sample Received by Analyst",
    "Sample Preparation",
    "Analysis",
    "Calculation and Result Entry"
   ]
  }
 ],
 "specifications": [
  {
   "code": "IS10500-ACC",
   "name": "IS 10500:2012 drinking water, acceptable limit",
   "limits": [
    {
     "test": "WTR-COLOUR",
     "param": "COLOUR",
     "min": null,
     "max": "5",
     "text": null
    },
    {
     "test": "WTR-ODOUR",
     "param": "ODOUR",
     "min": null,
     "max": null,
     "text": "Agreeable"
    },
    {
     "test": "WTR-PH",
     "param": "PH",
     "min": "6.5",
     "max": "8.5",
     "text": null
    },
    {
     "test": "WTR-TASTE",
     "param": "TASTE",
     "min": null,
     "max": null,
     "text": "Agreeable"
    },
    {
     "test": "WTR-TURB",
     "param": "TURB",
     "min": null,
     "max": "1",
     "text": null
    },
    {
     "test": "WTR-TDS",
     "param": "TDS",
     "min": null,
     "max": "500",
     "text": null
    },
    {
     "test": "WTR-AL",
     "param": "AL",
     "min": null,
     "max": "0.03",
     "text": null
    },
    {
     "test": "WTR-NH3N",
     "param": "NH3N",
     "min": null,
     "max": "0.5",
     "text": null
    },
    {
     "test": "WTR-MBAS",
     "param": "MBAS",
     "min": null,
     "max": "0.2",
     "text": null
    },
    {
     "test": "WTR-BA",
     "param": "BA",
     "min": null,
     "max": "0.7",
     "text": null
    },
    {
     "test": "WTR-B",
     "param": "B",
     "min": null,
     "max": "0.5",
     "text": null
    },
    {
     "test": "WTR-CA",
     "param": "CA",
     "min": null,
     "max": "75",
     "text": null
    },
    {
     "test": "WTR-CHLORAM",
     "param": "CHLORAM",
     "min": null,
     "max": "4",
     "text": null
    },
    {
     "test": "WTR-CL",
     "param": "CL",
     "min": null,
     "max": "250",
     "text": null
    },
    {
     "test": "WTR-CU",
     "param": "CU",
     "min": null,
     "max": "0.05",
     "text": null
    },
    {
     "test": "WTR-F",
     "param": "F",
     "min": null,
     "max": "1",
     "text": null
    },
    {
     "test": "WTR-FRC",
     "param": "FRC",
     "min": "0.2",
     "max": null,
     "text": "Min 0.2 (when chlorinated)"
    },
    {
     "test": "WTR-FE",
     "param": "FE",
     "min": null,
     "max": "1",
     "text": null
    },
    {
     "test": "WTR-MG",
     "param": "MG",
     "min": null,
     "max": "30",
     "text": null
    },
    {
     "test": "WTR-MN",
     "param": "MN",
     "min": null,
     "max": "0.1",
     "text": null
    },
    {
     "test": "WTR-MINOIL",
     "param": "MINOIL",
     "min": null,
     "max": "0.5",
     "text": null
    },
    {
     "test": "WTR-NO3",
     "param": "NO3",
     "min": null,
     "max": "45",
     "text": null
    },
    {
     "test": "WTR-PHENOL",
     "param": "PHENOL",
     "min": null,
     "max": "0.001",
     "text": null
    },
    {
     "test": "WTR-SE",
     "param": "SE",
     "min": null,
     "max": "0.01",
     "text": null
    },
    {
     "test": "WTR-AG",
     "param": "AG",
     "min": null,
     "max": "0.1",
     "text": null
    },
    {
     "test": "WTR-SO4",
     "param": "SO4",
     "min": null,
     "max": "200",
     "text": null
    },
    {
     "test": "WTR-ALK",
     "param": "ALK",
     "min": null,
     "max": "200",
     "text": null
    },
    {
     "test": "WTR-HARD",
     "param": "HARD",
     "min": null,
     "max": "200",
     "text": null
    },
    {
     "test": "WTR-ZN",
     "param": "ZN",
     "min": null,
     "max": "5",
     "text": null
    },
    {
     "test": "WTR-CD",
     "param": "CD",
     "min": null,
     "max": "0.003",
     "text": null
    },
    {
     "test": "WTR-CN",
     "param": "CN",
     "min": null,
     "max": "0.05",
     "text": null
    },
    {
     "test": "WTR-PB",
     "param": "PB",
     "min": null,
     "max": "0.01",
     "text": null
    },
    {
     "test": "WTR-HG",
     "param": "HG",
     "min": null,
     "max": "0.001",
     "text": null
    },
    {
     "test": "WTR-MO",
     "param": "MO",
     "min": null,
     "max": "0.07",
     "text": null
    },
    {
     "test": "WTR-NI",
     "param": "NI",
     "min": null,
     "max": "0.02",
     "text": null
    },
    {
     "test": "WTR-AS",
     "param": "AS",
     "min": null,
     "max": "0.01",
     "text": null
    },
    {
     "test": "WTR-CR",
     "param": "CR",
     "min": null,
     "max": "0.05",
     "text": null
    },
    {
     "test": "MIC-TC",
     "param": "TC",
     "min": null,
     "max": null,
     "text": "Shall not be detectable in any 100 mL sample"
    },
    {
     "test": "MIC-ECOLI",
     "param": "ECOLI",
     "min": null,
     "max": null,
     "text": "Shall not be detectable in any 100 mL sample"
    }
   ]
  },
  {
   "code": "IS10500-PERM",
   "name": "IS 10500:2012 drinking water, permissible limit in the absence of alternate source",
   "limits": [
    {
     "test": "WTR-COLOUR",
     "param": "COLOUR",
     "min": null,
     "max": "15",
     "text": null
    },
    {
     "test": "WTR-ODOUR",
     "param": "ODOUR",
     "min": null,
     "max": null,
     "text": "Agreeable"
    },
    {
     "test": "WTR-PH",
     "param": "PH",
     "min": "6.5",
     "max": "8.5",
     "text": null
    },
    {
     "test": "WTR-TASTE",
     "param": "TASTE",
     "min": null,
     "max": null,
     "text": "Agreeable"
    },
    {
     "test": "WTR-TURB",
     "param": "TURB",
     "min": null,
     "max": "5",
     "text": null
    },
    {
     "test": "WTR-TDS",
     "param": "TDS",
     "min": null,
     "max": "2000",
     "text": null
    },
    {
     "test": "WTR-AL",
     "param": "AL",
     "min": null,
     "max": "0.2",
     "text": null
    },
    {
     "test": "WTR-NH3N",
     "param": "NH3N",
     "min": null,
     "max": "0.5",
     "text": null
    },
    {
     "test": "WTR-MBAS",
     "param": "MBAS",
     "min": null,
     "max": "1",
     "text": null
    },
    {
     "test": "WTR-BA",
     "param": "BA",
     "min": null,
     "max": "0.7",
     "text": null
    },
    {
     "test": "WTR-B",
     "param": "B",
     "min": null,
     "max": "2.4",
     "text": null
    },
    {
     "test": "WTR-CA",
     "param": "CA",
     "min": null,
     "max": "200",
     "text": null
    },
    {
     "test": "WTR-CHLORAM",
     "param": "CHLORAM",
     "min": null,
     "max": "4",
     "text": null
    },
    {
     "test": "WTR-CL",
     "param": "CL",
     "min": null,
     "max": "1000",
     "text": null
    },
    {
     "test": "WTR-CU",
     "param": "CU",
     "min": null,
     "max": "1.5",
     "text": null
    },
    {
     "test": "WTR-F",
     "param": "F",
     "min": null,
     "max": "1.5",
     "text": null
    },
    {
     "test": "WTR-FE",
     "param": "FE",
     "min": null,
     "max": "1",
     "text": null
    },
    {
     "test": "WTR-MG",
     "param": "MG",
     "min": null,
     "max": "100",
     "text": null
    },
    {
     "test": "WTR-MN",
     "param": "MN",
     "min": null,
     "max": "0.3",
     "text": null
    },
    {
     "test": "WTR-MINOIL",
     "param": "MINOIL",
     "min": null,
     "max": "0.5",
     "text": null
    },
    {
     "test": "WTR-NO3",
     "param": "NO3",
     "min": null,
     "max": "45",
     "text": null
    },
    {
     "test": "WTR-PHENOL",
     "param": "PHENOL",
     "min": null,
     "max": "0.002",
     "text": null
    },
    {
     "test": "WTR-SE",
     "param": "SE",
     "min": null,
     "max": "0.01",
     "text": null
    },
    {
     "test": "WTR-AG",
     "param": "AG",
     "min": null,
     "max": "0.1",
     "text": null
    },
    {
     "test": "WTR-SO4",
     "param": "SO4",
     "min": null,
     "max": "400",
     "text": null
    },
    {
     "test": "WTR-ALK",
     "param": "ALK",
     "min": null,
     "max": "600",
     "text": null
    },
    {
     "test": "WTR-HARD",
     "param": "HARD",
     "min": null,
     "max": "600",
     "text": null
    },
    {
     "test": "WTR-ZN",
     "param": "ZN",
     "min": null,
     "max": "15",
     "text": null
    },
    {
     "test": "WTR-CD",
     "param": "CD",
     "min": null,
     "max": "0.003",
     "text": null
    },
    {
     "test": "WTR-CN",
     "param": "CN",
     "min": null,
     "max": "0.05",
     "text": null
    },
    {
     "test": "WTR-PB",
     "param": "PB",
     "min": null,
     "max": "0.01",
     "text": null
    },
    {
     "test": "WTR-HG",
     "param": "HG",
     "min": null,
     "max": "0.001",
     "text": null
    },
    {
     "test": "WTR-MO",
     "param": "MO",
     "min": null,
     "max": "0.07",
     "text": null
    },
    {
     "test": "WTR-NI",
     "param": "NI",
     "min": null,
     "max": "0.02",
     "text": null
    },
    {
     "test": "WTR-AS",
     "param": "AS",
     "min": null,
     "max": "0.01",
     "text": null
    },
    {
     "test": "WTR-CR",
     "param": "CR",
     "min": null,
     "max": "0.05",
     "text": null
    },
    {
     "test": "MIC-TC",
     "param": "TC",
     "min": null,
     "max": null,
     "text": "Shall not be detectable in any 100 mL sample"
    },
    {
     "test": "MIC-ECOLI",
     "param": "ECOLI",
     "min": null,
     "max": null,
     "text": "Shall not be detectable in any 100 mL sample"
    }
   ]
  },
  {
   "code": "EPR-SCH6-INLAND",
   "name": "EP Rules Schedule VI, general standards: discharge into inland surface water",
   "limits": [
    {
     "test": "WTR-TSS",
     "param": "TSS",
     "min": null,
     "max": "100",
     "text": null
    },
    {
     "test": "WTR-PH",
     "param": "PH",
     "min": "5.5",
     "max": "9",
     "text": null
    },
    {
     "test": "WTR-OG",
     "param": "OG",
     "min": null,
     "max": "10",
     "text": null
    },
    {
     "test": "WTR-TRC",
     "param": "TRC",
     "min": null,
     "max": "1",
     "text": null
    },
    {
     "test": "WTR-NH3N",
     "param": "NH3N",
     "min": null,
     "max": "50",
     "text": null
    },
    {
     "test": "WTR-TKN",
     "param": "TKN",
     "min": null,
     "max": "100",
     "text": null
    },
    {
     "test": "WTR-FNH3",
     "param": "FNH3",
     "min": null,
     "max": "5",
     "text": null
    },
    {
     "test": "WTR-BOD",
     "param": "BOD",
     "min": null,
     "max": "30",
     "text": null
    },
    {
     "test": "WTR-COD",
     "param": "COD",
     "min": null,
     "max": "250",
     "text": null
    },
    {
     "test": "WTR-AS",
     "param": "AS",
     "min": null,
     "max": "0.2",
     "text": null
    },
    {
     "test": "WTR-HG",
     "param": "HG",
     "min": null,
     "max": "0.01",
     "text": null
    },
    {
     "test": "WTR-PB",
     "param": "PB",
     "min": null,
     "max": "0.1",
     "text": null
    },
    {
     "test": "WTR-CD",
     "param": "CD",
     "min": null,
     "max": "2",
     "text": null
    },
    {
     "test": "WTR-CR6",
     "param": "CR6",
     "min": null,
     "max": "0.1",
     "text": null
    },
    {
     "test": "WTR-CR",
     "param": "CR",
     "min": null,
     "max": "2",
     "text": null
    },
    {
     "test": "WTR-CU",
     "param": "CU",
     "min": null,
     "max": "3",
     "text": null
    },
    {
     "test": "WTR-ZN",
     "param": "ZN",
     "min": null,
     "max": "5",
     "text": null
    },
    {
     "test": "WTR-SE",
     "param": "SE",
     "min": null,
     "max": "0.05",
     "text": null
    },
    {
     "test": "WTR-NI",
     "param": "NI",
     "min": null,
     "max": "3",
     "text": null
    },
    {
     "test": "WTR-CN",
     "param": "CN",
     "min": null,
     "max": "0.2",
     "text": null
    },
    {
     "test": "WTR-F",
     "param": "F",
     "min": null,
     "max": "2",
     "text": null
    },
    {
     "test": "WTR-PO4",
     "param": "PO4",
     "min": null,
     "max": "5",
     "text": null
    },
    {
     "test": "WTR-S",
     "param": "S",
     "min": null,
     "max": "2",
     "text": null
    },
    {
     "test": "WTR-PHENOL",
     "param": "PHENOL",
     "min": null,
     "max": "1",
     "text": null
    },
    {
     "test": "WTR-MN",
     "param": "MN",
     "min": null,
     "max": "2",
     "text": null
    },
    {
     "test": "WTR-FE",
     "param": "FE",
     "min": null,
     "max": "3",
     "text": null
    },
    {
     "test": "WTR-V",
     "param": "V",
     "min": null,
     "max": "0.2",
     "text": null
    },
    {
     "test": "WTR-NO3N",
     "param": "NO3N",
     "min": null,
     "max": "10",
     "text": null
    }
   ]
  },
  {
   "code": "NAAQS-24H",
   "name": "NAAQS 2009, 24-hourly: industrial, residential, rural and other areas",
   "limits": [
    {
     "test": "AAQ-SO2",
     "param": "SO2",
     "min": null,
     "max": "80",
     "text": null
    },
    {
     "test": "AAQ-NO2",
     "param": "NO2",
     "min": null,
     "max": "80",
     "text": null
    },
    {
     "test": "AAQ-PM10",
     "param": "PM10",
     "min": null,
     "max": "100",
     "text": null
    },
    {
     "test": "AAQ-PM25",
     "param": "PM25",
     "min": null,
     "max": "60",
     "text": null
    },
    {
     "test": "AAQ-PB",
     "param": "PB",
     "min": null,
     "max": "1",
     "text": null
    },
    {
     "test": "AAQ-NH3",
     "param": "NH3",
     "min": null,
     "max": "400",
     "text": null
    }
   ]
  },
  {
   "code": "NAAQS-8H",
   "name": "NAAQS 2009, 8-hourly: industrial, residential, rural and other areas",
   "limits": [
    {
     "test": "AAQ-O3",
     "param": "O3",
     "min": null,
     "max": "100",
     "text": null
    },
    {
     "test": "AAQ-CO",
     "param": "CO",
     "min": null,
     "max": "2",
     "text": null
    }
   ]
  },
  {
   "code": "NAAQS-ANNUAL",
   "name": "NAAQS 2009, annual: industrial, residential, rural and other areas",
   "limits": [
    {
     "test": "AAQ-SO2",
     "param": "SO2",
     "min": null,
     "max": "50",
     "text": null
    },
    {
     "test": "AAQ-NO2",
     "param": "NO2",
     "min": null,
     "max": "40",
     "text": null
    },
    {
     "test": "AAQ-PM10",
     "param": "PM10",
     "min": null,
     "max": "60",
     "text": null
    },
    {
     "test": "AAQ-PM25",
     "param": "PM25",
     "min": null,
     "max": "40",
     "text": null
    },
    {
     "test": "AAQ-PB",
     "param": "PB",
     "min": null,
     "max": "0.5",
     "text": null
    },
    {
     "test": "AAQ-NH3",
     "param": "NH3",
     "min": null,
     "max": "100",
     "text": null
    },
    {
     "test": "AAQ-C6H6",
     "param": "C6H6",
     "min": null,
     "max": "5",
     "text": null
    },
    {
     "test": "AAQ-BAP",
     "param": "BAP",
     "min": null,
     "max": "1",
     "text": null
    },
    {
     "test": "AAQ-AS",
     "param": "AS",
     "min": null,
     "max": "6",
     "text": null
    },
    {
     "test": "AAQ-NI",
     "param": "NI",
     "min": null,
     "max": "20",
     "text": null
    }
   ]
  },
  {
   "code": "NOISE-IND",
   "name": "Noise Rules 2000: industrial area",
   "limits": [
    {
     "test": "NOISE-AMB",
     "param": "LEQ_DAY",
     "min": null,
     "max": "75",
     "text": null
    },
    {
     "test": "NOISE-AMB",
     "param": "LEQ_NIGHT",
     "min": null,
     "max": "70",
     "text": null
    }
   ]
  },
  {
   "code": "NOISE-COM",
   "name": "Noise Rules 2000: commercial area",
   "limits": [
    {
     "test": "NOISE-AMB",
     "param": "LEQ_DAY",
     "min": null,
     "max": "65",
     "text": null
    },
    {
     "test": "NOISE-AMB",
     "param": "LEQ_NIGHT",
     "min": null,
     "max": "55",
     "text": null
    }
   ]
  },
  {
   "code": "NOISE-RES",
   "name": "Noise Rules 2000: residential area",
   "limits": [
    {
     "test": "NOISE-AMB",
     "param": "LEQ_DAY",
     "min": null,
     "max": "55",
     "text": null
    },
    {
     "test": "NOISE-AMB",
     "param": "LEQ_NIGHT",
     "min": null,
     "max": "45",
     "text": null
    }
   ]
  },
  {
   "code": "NOISE-SIL",
   "name": "Noise Rules 2000: silence zone",
   "limits": [
    {
     "test": "NOISE-AMB",
     "param": "LEQ_DAY",
     "min": null,
     "max": "50",
     "text": null
    },
    {
     "test": "NOISE-AMB",
     "param": "LEQ_NIGHT",
     "min": null,
     "max": "40",
     "text": null
    }
   ]
  }
 ],
 "groups": [
  {
   "code": "PKG-DW-BASIC",
   "name": "Drinking water, basic (IS 10500)",
   "tests": [
    "WTR-PH",
    "WTR-TURB",
    "WTR-COLOUR",
    "WTR-ODOUR",
    "WTR-TDS",
    "WTR-HARD",
    "WTR-CA",
    "WTR-MG",
    "WTR-ALK",
    "WTR-CL",
    "WTR-SO4",
    "WTR-NO3",
    "WTR-F",
    "WTR-FE",
    "MIC-TC",
    "MIC-ECOLI"
   ]
  },
  {
   "code": "PKG-DW-FULL",
   "name": "Drinking water, complete IS 10500 parameters in this catalogue",
   "tests": [
    "WTR-COLOUR",
    "WTR-ODOUR",
    "WTR-PH",
    "WTR-TASTE",
    "WTR-TURB",
    "WTR-TDS",
    "WTR-AL",
    "WTR-NH3N",
    "WTR-MBAS",
    "WTR-BA",
    "WTR-B",
    "WTR-CA",
    "WTR-CHLORAM",
    "WTR-CL",
    "WTR-CU",
    "WTR-F",
    "WTR-FRC",
    "WTR-FE",
    "WTR-MG",
    "WTR-MN",
    "WTR-MINOIL",
    "WTR-NO3",
    "WTR-PHENOL",
    "WTR-SE",
    "WTR-AG",
    "WTR-SO4",
    "WTR-ALK",
    "WTR-HARD",
    "WTR-ZN",
    "WTR-CD",
    "WTR-CN",
    "WTR-PB",
    "WTR-HG",
    "WTR-MO",
    "WTR-NI",
    "WTR-AS",
    "WTR-CR",
    "MIC-TC",
    "MIC-ECOLI"
   ]
  },
  {
   "code": "PKG-EFFLUENT",
   "name": "Effluent, EP Rules Schedule VI general parameters",
   "tests": [
    "WTR-PH",
    "WTR-TSS",
    "WTR-OG",
    "WTR-BOD",
    "WTR-COD",
    "WTR-TRC",
    "WTR-NH3N",
    "WTR-TKN",
    "WTR-FNH3",
    "WTR-PO4",
    "WTR-S",
    "WTR-PHENOL",
    "WTR-CN",
    "WTR-F",
    "WTR-NO3N"
   ]
  },
  {
   "code": "PKG-EFFLUENT-METALS",
   "name": "Effluent, heavy metals (EP Rules Schedule VI)",
   "tests": [
    "WTR-AS",
    "WTR-HG",
    "WTR-PB",
    "WTR-CD",
    "WTR-CR6",
    "WTR-CR",
    "WTR-CU",
    "WTR-ZN",
    "WTR-SE",
    "WTR-NI",
    "WTR-MN",
    "WTR-FE",
    "WTR-V"
   ]
  },
  {
   "code": "PKG-AAQ-NAAQS",
   "name": "Ambient air, NAAQS 2009 (12 parameters)",
   "tests": [
    "AAQ-PM10",
    "AAQ-PM25",
    "AAQ-SO2",
    "AAQ-NO2",
    "AAQ-CO",
    "AAQ-O3",
    "AAQ-NH3",
    "AAQ-PB",
    "AAQ-NI",
    "AAQ-AS",
    "AAQ-C6H6",
    "AAQ-BAP"
   ]
  },
  {
   "code": "PKG-AAQ-BASIC",
   "name": "Ambient air, basic (PM10, PM2.5, SO2, NO2)",
   "tests": [
    "AAQ-PM10",
    "AAQ-PM25",
    "AAQ-SO2",
    "AAQ-NO2"
   ]
  },
  {
   "code": "PKG-STACK",
   "name": "Stack emission monitoring",
   "tests": [
    "STK-FLOW",
    "STK-GAS",
    "STK-MOIST",
    "STK-PM",
    "STK-SO2",
    "STK-NOX",
    "STK-CO"
   ]
  },
  {
   "code": "PKG-SOIL-FERT",
   "name": "Soil fertility",
   "tests": [
    "SOIL-PH",
    "SOIL-EC",
    "SOIL-OC",
    "SOIL-N",
    "SOIL-P",
    "SOIL-K"
   ]
  },
  {
   "code": "PKG-SOIL-FULL",
   "name": "Soil, complete",
   "tests": [
    "SOIL-PH",
    "SOIL-EC",
    "SOIL-MOIST",
    "SOIL-OC",
    "SOIL-TEXT",
    "SOIL-BD",
    "SOIL-CEC",
    "SOIL-N",
    "SOIL-P",
    "SOIL-K",
    "SOIL-METALS"
   ]
  },
  {
   "code": "PKG-NOISE",
   "name": "Ambient noise monitoring",
   "tests": [
    "NOISE-AMB"
   ]
  },
  {
   "code": "PKG-MECH-WELD",
   "name": "Mechanical, weld and plate qualification",
   "tests": [
    "MT-TENS",
    "MT-BEND",
    "MT-IMPACT",
    "MT-HV"
   ]
  }
 ],
 "remarkTemplates": [
  {
   "code": "RT-MEETS-SPEC",
   "outcome": "PASS",
   "text": "The sample meets the requirements of the specification for the parameters tested."
  },
  {
   "code": "RT-NOT-MEET-SPEC",
   "outcome": "FAIL",
   "text": "The sample does not meet the requirements of the specification for one or more of the parameters tested."
  },
  {
   "code": "RT-AS-RECEIVED",
   "outcome": "ANY",
   "text": "The results relate to the sample as received."
  }
 ],
 "templates": [
  {
   "id": "water",
   "name": "Water and wastewater",
   "description": "Drinking water to IS 10500, effluent to the Environment (Protection) Rules, with microbiology.",
   "departments": [
    "WTR",
    "MICRO"
   ]
  },
  {
   "id": "air",
   "name": "Ambient air and stack emission",
   "description": "NAAQS 2009 ambient air monitoring and stack emission testing.",
   "departments": [
    "AIR"
   ]
  },
  {
   "id": "soil",
   "name": "Soil, sludge and solid waste",
   "description": "Soil fertility and characterisation, metals and TCLP.",
   "departments": [
    "SOIL"
   ]
  },
  {
   "id": "noise",
   "name": "Noise monitoring",
   "description": "Ambient and workplace noise with the limits of the Noise Rules 2000.",
   "departments": [
    "NOISE"
   ]
  },
  {
   "id": "materials",
   "name": "Materials and metals",
   "description": "Mechanical testing, chemical analysis by OES, metallography and coatings.",
   "departments": [
    "MECH",
    "METL"
   ]
  }
 ]
};
