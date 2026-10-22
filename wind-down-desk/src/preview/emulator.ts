/**
 * "Preview on this screen" (computer without a headset): the IWER emulator (Meta's WebXR emulator, the one used
 * to build and film this app) installed BEFORE the world is created, so IWSDK sees an emulated Meta Quest 3.
 * Loaded only after the person asks for it (?preview=1) on a device without immersive sessions: never on a Quest,
 * never in the default bundle (dynamic import → its own chunk). No synthetic room (no planes / depth): the desk
 * floats, and the preview opens a night place in Full immersion instead of passthrough.
 */
export async function installEmulator(): Promise<boolean> {
  try {
    const { XRDevice, metaQuest3 } = await import('iwer');
    const device = new XRDevice(metaQuest3, { stereoEnabled: false });
    device.installRuntime({ forceInstall: true });
    (window as unknown as { IWER_DEVICE?: unknown }).IWER_DEVICE = device;
    document.documentElement.classList.add('wdd-preview');
    return true;
  } catch (error) {
    console.warn('[wdd] emulated preview unavailable:', error instanceof Error ? error.message : error);
    return false;
  }
}
