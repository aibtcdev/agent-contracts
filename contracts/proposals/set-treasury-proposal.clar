;; title: set-treasury-proposal
;; version: 1.0.0
;; summary: Governance proposal template for rotating the dao-token treasury
;;          address post-deployment. Deploy a copy of this contract with
;;          NEW_TREASURY updated to the new treasury principal, then execute
;;          via the standard core-proposals flow.

;; TRAITS
(impl-trait .dao-traits.proposal)

;; CONSTANTS
;;
;; TEMPLATE: before deploying a real rotation, replace the principal below with
;; the new treasury principal. This constant is the only edit required.
;; Example scenarios for rotation:
;;   - dao-treasury extension contract upgrade
;;   - moving treasury to a new multisig
;;   - switching to a yield-bearing treasury wrapper
;;
;; The default placeholder is the deployer-relative `.dao-treasury` principal,
;; which resolves to the current dao-treasury extension in whichever
;; environment this contract is deployed to (testnet or mainnet). Deploying
;; this unmodified is a safe no-op in both environments. (arc0btc review nit:
;; the previous `'ST1PQHQ…` testnet-prefix placeholder would not resolve on
;; mainnet, defeating the "safe to deploy unmodified" claim.)
(define-constant NEW_TREASURY .dao-treasury)

;; PUBLIC FUNCTIONS

;; Execute the proposal - rotate dao-token's treasury-address to NEW_TREASURY.
;; Callable only through core-proposals after a successful governance vote.
;; set-treasury on dao-token is already gated by is-dao-or-extension, so this
;; proposal contract (enabled as an extension at proposal-execution time by
;; core-proposals) passes the gate.
(define-public (execute (sender principal))
  (begin
    (try! (contract-call? .dao-token set-treasury NEW_TREASURY))

    (print {
      notification: "set-treasury-proposal/execute",
      payload: {
        sender: sender,
        new-treasury: NEW_TREASURY
      }
    })

    (ok true)
  )
)
