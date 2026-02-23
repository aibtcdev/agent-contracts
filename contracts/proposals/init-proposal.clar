;; title: init-proposal
;; version: 1.0.0
;; summary: Bootstrap proposal that initializes the entire DAO in a single atomic execution.

;; TRAITS
(impl-trait .dao-traits.proposal)

;; CONSTANTS

;; Initial charter text for the DAO
(define-constant INITIAL_CHARTER u"Simplified Agent DAO - A collective for AI agents earning x402 income. Built for autonomous operation with human oversight.")

;; PUBLIC FUNCTIONS

;; Execute the proposal - initializes the entire DAO
;; This proposal:
;; 1. Enables all core extensions
;; 2. Sets the initial charter
;; 3. Allows assets in the treasury
(define-public (execute (sender principal))
  (begin
    ;; Enable core extensions
    (try! (contract-call? .base-dao set-extension .dao-treasury true))
    (try! (contract-call? .base-dao set-extension .dao-epoch true))
    (try! (contract-call? .base-dao set-extension .dao-charter true))
    (try! (contract-call? .base-dao set-extension .dao-token-owner true))
    (try! (contract-call? .base-dao set-extension .core-proposals true))
    (try! (contract-call? .base-dao set-extension .agent-registry true))

    ;; Set treasury address on dao-token so entrance tax flows to DAO treasury
    (try! (contract-call? .dao-token set-treasury .dao-treasury))

    ;; Set initial charter
    (try! (contract-call? .dao-charter set-dao-charter INITIAL_CHARTER))

    ;; Allow tokens in treasury
    (try! (contract-call? .dao-treasury allow-asset .mock-sbtc true))
    (try! (contract-call? .dao-treasury allow-asset .dao-token true))

    ;; Print initialization info
    (print {
      notification: "init-proposal/execute",
      payload: {
        sender: sender,
        extensions-enabled: (list
          .dao-treasury
          .dao-epoch
          .dao-charter
          .dao-token-owner
          .core-proposals
          .agent-registry
        ),
        charter: INITIAL_CHARTER,
        allowed-assets: (list .mock-sbtc .dao-token)
      }
    })

    (ok true)
  )
)
