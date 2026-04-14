// 1. Export everything from generated/api.ts as VALUES (Zod schemas)
export * from "./generated/api";

// 2. Export ONLY the types/interfaces from generated/types/
// Using 'export type' ensures there is zero overlap with the Zod values
export type { 
  AdminLoginResponse, 
  CrmFetchPropertyDataResponse, 
  CrmLoginResponse, 
  CrmSkipTraceResponse 
} from "./generated/types";

// 3. To be safe, if there are many other types, you can keep this:
export type * from "./generated/types";
