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
;; The default placeholder here is the current dao-treasury extension, so
;; deploying this unmodified is a no-op (safe reference behaviour).
(define-constant NEW_TREASURY 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.dao-treasury)

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
