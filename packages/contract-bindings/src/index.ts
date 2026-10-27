export * as lease from "../lease/src/index.js";
export * as titleRegistry from "../title-registry/src/index.js";

export {
  Client as LeaseClient,
  Status as LeaseStatus,
  type Lease,
  type Terms as LeaseTerms,
  type LeaseView,
  Errors as LeaseErrors,
  networks as leaseNetworks,
} from "../lease/src/index.js";

export {
  Client as TitleRegistryClient,
  type TitleEntry,
  type AssetRecord,
  Errors as TitleRegistryErrors,
  networks as titleRegistryNetworks,
} from "../title-registry/src/index.js";
