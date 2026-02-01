# Mainnet Deployment Guide

This document describes the changes required when deploying the DAO contracts to mainnet.

## sBTC Configuration

The DAO token contract (`dao-token.clar`) uses sBTC for backing the minted tokens. For testing (simnet/devnet), the contract uses `mock-sbtc`. For mainnet, you must update the contract to use the real sBTC contract.

### Mainnet sBTC Contract

```
Contract ID: SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
```

The mainnet sBTC contract is already cached as a Clarinet requirement and implements the SIP-010 fungible token standard.

### 1. Update dao-token.clar

Replace all occurrences of `.mock-sbtc` with the mainnet sBTC contract principal.

**Lines to update:**

| Line | Function | Current | Mainnet |
|------|----------|---------|---------|
| 102 | deposit | `.mock-sbtc` | `'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` |
| 106 | deposit (tax) | `.mock-sbtc` | `'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` |
| 151 | withdraw | `.mock-sbtc` | `'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` |

**Example change:**

```clarity
;; Change from (testing):
(try! (contract-call? .mock-sbtc transfer amount sender DAO_CONTRACT none))

;; To (mainnet):
(try! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token transfer amount sender DAO_CONTRACT none))
```

### 2. Update sbtc-config.clar (optional)

If using the config contract for reference, update it as well:

```clarity
;; Change from (testing):
(define-constant SBTC_CONTRACT .mock-sbtc)

;; To (mainnet):
(define-constant SBTC_CONTRACT 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)

;; Also update is-mainnet-config to return true
(define-read-only (is-mainnet-config)
  true
)
```

### 3. Verify sBTC Contract Interface

Before deployment, verify the mainnet sBTC contract implements the required SIP-010 functions:

- `transfer` - Transfer sBTC between accounts
- `get-balance` - Get sBTC balance for an address
- `get-total-supply` - Get total sBTC supply

The mainnet sBTC contract ABI is cached at:
`.cache/requirements/SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token.clar`

## Deployment Checklist

### Pre-Deployment

- [ ] Update `dao-token.clar` with mainnet sBTC contract reference
- [ ] Update `sbtc-config.clar` if using
- [ ] Run `clarinet check` - must pass
- [ ] Run all tests with mock-sbtc to verify no regressions
- [ ] Review entrance tax configuration (default: 10% / 1000 basis points)
- [ ] Review tax change delay (default: 1008 blocks / ~7 days)
- [ ] Set correct treasury address

### Deployment Order

Deploy contracts in dependency order:

1. **Traits**
   - `dao-traits`
   - `agent-traits`

2. **Core DAO**
   - `base-dao`

3. **Token**
   - `dao-token` (with mainnet sBTC reference)
   - `sbtc-config` (optional, for documentation)

4. **Extensions**
   - `dao-treasury`
   - `dao-epoch`
   - `dao-charter`
   - `dao-token-owner`
   - `core-proposals`

5. **Proposals**
   - `init-proposal` (to initialize DAO)
   - Additional governance proposals

6. **Agent Contracts**
   - `agent-registry`
   - `agent-account`

### Post-Deployment

- [ ] Execute `init-proposal` to bootstrap the DAO
- [ ] Verify all extensions are enabled
- [ ] Verify treasury address is correct
- [ ] Test deposit with small amount of sBTC
- [ ] Verify tax collection works correctly

## Testing on Testnet

For testnet deployment, you have two options:

1. **Use testnet sBTC** (if available): Update the contract reference to the testnet sBTC contract
2. **Deploy your own test token**: Deploy `mock-sbtc` to testnet and use it for testing

## Security Considerations

1. **No runtime switching**: Clarity requires contract principals at compile time. The sBTC contract cannot be changed after deployment.

2. **One-way deployment**: Once deployed with mainnet sBTC, the contract cannot be upgraded to use a different sBTC implementation.

3. **Tax rate protection**: Tax rate changes are time-delayed (1008 blocks / ~7 days) to protect users from sudden tax increases.

4. **Ownership timelock**: Token ownership transfers via `dao-token-owner` use the same timelock pattern for security.

## Related Files

- `contracts/token/dao-token.clar` - Main token contract (update for mainnet)
- `contracts/token/mock-sbtc.clar` - Mock sBTC for testing (do not deploy to mainnet)
- `contracts/config/sbtc-config.clar` - Configuration reference
- `Clarinet.toml` - Contains mainnet sBTC as a requirement
