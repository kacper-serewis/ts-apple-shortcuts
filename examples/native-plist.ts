import { native, raw, plistData, plistDate } from "@js-shortcuts/ios";

// An empty icon-image data field appears in native exports; retain its plist type.
export const shortcut = {
  WFWorkflowName: "Native plist types",
  WFWorkflowIcon: {
    WFWorkflowIconStartColor: 4282601983,
    WFWorkflowIconGlyphNumber: 59511,
    WFWorkflowIconImageData: plistData(""),
  },
};

export default async function main(): Promise<void> {
  // Illustrative app-specific parameters: use the keys from your app's actual export.
  // This example is compile-tested only; com.example is not an installed action.
  await native("com.example.app.UseArchivedSettings", raw({
    archive: plistData("AAH/gA=="),
    timestamp: plistDate("2026-10-19T12:00:00Z"),
  }));
}
