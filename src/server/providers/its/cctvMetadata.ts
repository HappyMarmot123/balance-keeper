export type ItsCctvMetadata = Readonly<{
  cameraId: string;
  url: string;
}>;

export class ItsCctvCameraNotFoundError extends Error {
  constructor() {
    super('ITS CCTV camera was not found');
    this.name = 'ItsCctvCameraNotFoundError';
  }
}

export function selectItsCctvMetadataById(metadata: readonly ItsCctvMetadata[], cameraId: string): ItsCctvMetadata {
  const selected = metadata.find((candidate) => candidate.cameraId === cameraId);
  if (selected === undefined) {
    throw new ItsCctvCameraNotFoundError();
  }
  return selected;
}
