export interface RadarCalibration {
  posX: number;
  posY: number;
  scale: number;
}

export const RADAR_REFERENCE_SIZE = 1024;

export const RADAR_CALIBRATION: Record<string, RadarCalibration> = {
  de_dust2: { posX: -2476, posY: 3239, scale: 4.4 },
  de_mirage: { posX: -3230, posY: 1713, scale: 5.0 },
  de_inferno: { posX: -2087, posY: 3870, scale: 4.9 },
  de_nuke: { posX: -3453, posY: 2887, scale: 7 },
  de_overpass: { posX: -4831, posY: 1781, scale: 5.2 },
  de_vertigo: { posX: -3168, posY: 1762, scale: 4.0 },
  de_ancient: { posX: -2953, posY: 2164, scale: 5 },
  de_anubis: { posX: -2796, posY: 3328, scale: 5.22 },
  de_train: { posX: -2308, posY: 2078, scale: 4.082077 },
  de_cache: { posX: -2000, posY: 3250, scale: 5.5 },
  cs_italy: { posX: -2647, posY: 2592, scale: 4.6 },
  cs_office: { posX: -1838, posY: 1858, scale: 4.1 },
};

export const RADAR_EXTRACTABLE_MAPS = Object.keys(RADAR_CALIBRATION);
