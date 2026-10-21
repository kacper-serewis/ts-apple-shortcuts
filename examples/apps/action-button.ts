/// <reference path="../../api/apps/home-assistant-release-fire-event.d.ts" />
import { Focus, attachment, HomeAssistantRelease, Maps, Shortcuts, System, currentDate, entityProperty, formatDate, openApp, raw, vibrate } from "@js-shortcuts/ios";

// "Action Button": one shortcut for the iPhone Action Button. The first matching rule wins:
//   1. Spotify is playing (asked from Home Assistant, so a Chromecast counts too)
//      → fire Home Assistant event `action_button` {"mode":"spotify_pause"}.
//   2. The Driving focus is on → directions home when within 1 km of work, else to work.
//   3. Landscape (left or right) → toggle the orientation lock.
//   4. 00:00–05:59 → toggle the flashlight.
//   5. 22:00–23:59 → fire Home Assistant event `action_button` {"mode":"bedtijd"}.
//   6. Otherwise → open "Ik weet wat ik eet".
// Each rule ends with a short vibration. No dialogs or result views.
// Compile with --app api/apps/home-assistant-release-fire-event.json (App Store app).

export default async function main(): Promise<void> {
  // Module-level constants are not supported yet, so the settings open main().
  const WORK_ADDRESS = "Klokgebouw 234, 5617 AC Eindhoven";
  const WORK_LAT = 51.448972;
  const WORK_LON = 5.4573266;
  const HOME_ADDRESS = "Wijsthoek 209, 5403 RB Uden";
  // Flat approximation around work (no trigonometry on the device): kilometres per degree
  // of latitude, and per degree of longitude = KM_PER_DEGREE * cos(WORK_LAT).
  const KM_PER_DEGREE = 111.32;
  const COS_WORK_LAT = 0.623211;
  const NEAR_WORK_KM = 1;

  const SPOTIFY_PLAYING = "{{ is_state('media_player.spotify_kacper','playing') }}";

  // Home Assistant server: the app resolves a server identifier it does not know to its
  // only configured server (2026.9.3+). With several servers, select one on the device.
  // raw() values cannot be stored in a const yet, so each call repeats it.
  const spotify = await HomeAssistantRelease.renderTemplate({ server: raw({ identifier: "only-server", title: { key: "Home Assistant" }, subtitle: { key: "Home Assistant" } }), template: SPOTIFY_PLAYING });
  // Without a focus, the name is empty.
  const focusName = entityProperty(await Focus.getCurrentFocus(), "Name");
  if (spotify.trim().toLowerCase() === "true") {
    await HomeAssistantRelease.fireEvent({ server: raw({ identifier: "only-server", title: { key: "Home Assistant" }, subtitle: { key: "Home Assistant" } }), eventName: "action_button", eventData: '{"mode":"spotify_pause"}' });
  } else if (focusName.includes("Driving")) {
    const here = await Maps.getCurrentLocation({});
    const north = (entityProperty<number>(here, "Latitude") - WORK_LAT) * KM_PER_DEGREE;
    const east = (entityProperty<number>(here, "Longitude") - WORK_LON) * KM_PER_DEGREE * COS_WORK_LAT;
    // Maps needs the address as a variable: attachment() adds a Text action. A plain string
    // destination is shown by the editor but does not open Maps (iOS 26.5 simulator).
    if (north * north + east * east <= NEAR_WORK_KM * NEAR_WORK_KM) {
      await Maps.openDirections({ WFDestination: attachment(HOME_ADDRESS) });
    } else {
      await Maps.openDirections({ WFDestination: attachment(WORK_ADDRESS) });
    }
  } else {
    const orientation = await Shortcuts.getOrientation();
    const hour = Number(await formatDate(await currentDate(), "H"));
    if (orientation === "Landscape Left" || orientation === "Landscape Right") {
      await System.setOrientationLock({ operation: "toggle" });
    } else if (hour < 6) {
      await System.setFlashlight({ operation: "toggle" });
    } else if (hour >= 22) {
      await HomeAssistantRelease.fireEvent({ server: raw({ identifier: "only-server", title: { key: "Home Assistant" }, subtitle: { key: "Home Assistant" } }), eventName: "action_button", eventData: '{"mode":"bedtijd"}' });
    } else {
      await openApp({ bundleIdentifier: "nl.serewis.ikweetwatikeet", name: "Ik weet wat ik eet", teamIdentifier: "NYSBRSGD6C" });
    }
  }
  await vibrate();
}
