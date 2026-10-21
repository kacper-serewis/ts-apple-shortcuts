import { Focus, attachment, Maps, Shortcuts, System, askNumber, askText, entityProperty, openApp, showResult } from "@js-shortcuts/ios";

// Simulator probe for examples/apps/action-button.ts: the same rules and native actions, but
// the Home Assistant answers and the hour are typed in, and each branch first shows its name.
// Home Assistant is replaced by a result view (no server in the simulator; no real HA calls).
export default async function main(): Promise<void> {
  const WORK_ADDRESS = "Klokgebouw 234, 5617 AC Eindhoven";
  const WORK_LAT = 51.448972;
  const WORK_LON = 5.4573266;
  const HOME_ADDRESS = "Wijsthoek 209, 5403 RB Uden";
  const KM_PER_DEGREE = 111.32;
  const COS_WORK_LAT = 0.623211;
  const NEAR_WORK_KM = 1;

  const spotify = await askText("Render template result (True/False)");
  const focus = await Focus.getCurrentFocus();
  const realFocus = entityProperty(focus, "Name");
  const typedFocus = await askText(`Focus is "${realFocus}". Type a focus name to use, or - for the real one`);
  const focusName = typedFocus === "-" ? realFocus : typedFocus;
  if (spotify.trim().toLowerCase() === "true") {
    await showResult('Branch: spotify_pause {"mode":"spotify_pause"}');
  } else if (focusName.includes("Driving")) {
    const here = await Maps.getCurrentLocation({});
    const north = (entityProperty<number>(here, "Latitude") - WORK_LAT) * KM_PER_DEGREE;
    const east = (entityProperty<number>(here, "Longitude") - WORK_LON) * KM_PER_DEGREE * COS_WORK_LAT;
    const squared = north * north + east * east;
    if (squared <= NEAR_WORK_KM * NEAR_WORK_KM) {
      await showResult(`Branch: driving, near work (${squared} km²) → home`);
      await Maps.openDirections({ WFDestination: attachment(HOME_ADDRESS) });
    } else {
      await showResult(`Branch: driving, away from work (${squared} km²) → work`);
      await Maps.openDirections({ WFDestination: attachment(WORK_ADDRESS) });
    }
  } else {
    const orientation = await Shortcuts.getOrientation();
    const hour = await askNumber(`Orientation: ${orientation}. Hour (0-23)?`);
    if (orientation === "Landscape Left" || orientation === "Landscape Right") {
      await showResult("Branch: landscape → orientation lock");
      await System.setOrientationLock({ operation: "toggle" });
    } else if (hour < 6) {
      await showResult("Branch: night → flashlight");
      await System.setFlashlight({ operation: "toggle" });
    } else if (hour >= 22) {
      await showResult('Branch: bedtime {"mode":"bedtijd"}');
    } else {
      await showResult("Branch: open app");
      await openApp({ bundleIdentifier: "nl.serewis.ikweetwatikeet", name: "Ik weet wat ik eet", teamIdentifier: "NYSBRSGD6C" });
    }
  }
  await showResult("Done");
}
