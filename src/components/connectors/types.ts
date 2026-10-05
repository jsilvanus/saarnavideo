export type Pair = { key: string; value: string };
export type AuthType = "none" | "bearer" | "api_key" | "basic";
export type MappingRow = { jsonPath: string; variable: string; skipIfNull: boolean };

export type ApiRequestView = {
  id: string;
  connectorId: string;
  name: string;
  method: string;
  path: string;
  query: Pair[];
  bodyType: "none" | "json" | "text";
  body: string | null;
  responseType: "auto" | "json" | "text";
  mappings: MappingRow[];
  timeoutMs: number | null;
};

export type ApiConnectorView = {
  id: string;
  name: string;
  baseUrl: string;
  auth: { type: AuthType; headerName?: string; username?: string; hasSecret: boolean };
  headers: Pair[];
  requests: ApiRequestView[];
};

/**
 * Starting point for a church year API such as anno-api: nothing about the address is filled in.
 * `weekdayMaterial` comes first so that `holyDay`, which wins when present, overwrites it.
 */
export const CHURCH_YEAR_REQUEST_PRESET = {
  name: "Kirkkovuosi (päivä)",
  method: "GET",
  path: "/api/v1/date/{{paiva}}",
  query: [{ key: "cycles", value: "false" }],
  bodyType: "none",
  responseType: "auto",
  mappings: [
    { jsonPath: "$.weekdayMaterial.name", variable: "pyhapaiva", skipIfNull: true },
    { jsonPath: "$.holyDay.name", variable: "pyhapaiva", skipIfNull: true },
    { jsonPath: "$.weekdayMaterial.theme", variable: "teema", skipIfNull: true },
    { jsonPath: "$.holyDay.theme", variable: "teema", skipIfNull: true },
    { jsonPath: "$.weekdayMaterial.texts.gospel.reference", variable: "evankeliumi", skipIfNull: true },
    { jsonPath: "$.holyDay.texts.gospel.reference", variable: "evankeliumi", skipIfNull: true },
    { jsonPath: "$.weekdayMaterial.texts.gospel.text", variable: "evankeliumiteksti", skipIfNull: true },
    { jsonPath: "$.holyDay.texts.gospel.text", variable: "evankeliumiteksti", skipIfNull: true },
    { jsonPath: "$.liturgicalColor.color", variable: "vari", skipIfNull: true },
    { jsonPath: "$.season", variable: "jakso", skipIfNull: true },
    { jsonPath: "$.period", variable: "aika", skipIfNull: true },
  ],
};
