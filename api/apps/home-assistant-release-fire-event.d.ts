// Generated from App Intents metadata. Availability and native bindings are separate.
declare module "@js-shortcuts/ios" {
  export namespace HomeAssistantRelease {
    export interface Entity<Name extends string> extends NativeContent { readonly __appEntity: Name; readonly __appBundle: "io.robbie.HomeAssistant" }
    export type IntentServerAppEntity = Entity<"IntentServerAppEntity">;
    /** Native export binding available. */
    export function fireEvent(parameters: { "server": Entity<"IntentServerAppEntity"> | NativeEncoded; "eventName": string | NativeEncoded; "eventData": string | NativeEncoded }): Promise<string>;
  }
}
