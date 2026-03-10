;; title: init-pegged-dao
;; version: 2.0.0
;; summary: Bootstrap proposal for a pegged agent DAO (v2 - no guardians).
;; description: One-click DAO deployment. Enables all extensions, configures
;; the pegged token with name/symbol/tax, seeds reputation registry,
;; sets up micro-payout amounts, and allows sBTC in treasury.
;; v2: No guardian council. Replaced by reputation-registry + treasury-proposals.

;; TRAITS
(impl-trait .dao-traits.proposal)

;; CONSTANTS
(define-constant DAO_NAME "Agent DAO")
(define-constant TOKEN_NAME "Agent DAO BTC")
(define-constant TOKEN_SYMBOL "aDAO")
(define-constant ENTRANCE_TAX u100) ;; 1% (100 basis points)

;; Default micro-payout amounts (in sats / smallest sBTC unit)
;; Work types: 1=checkin (on-chain verified), 2=proof (on-chain verified)
(define-constant PAYOUT_CHECKIN u100)
(define-constant PAYOUT_PROOF u300)

(define-public (execute (sender principal))
  (begin
    ;; 1. Enable all extensions (6 - no guardian council)
    (try! (contract-call? .base-dao set-extensions
      (list
        { extension: .dao-pegged, enabled: true }
        { extension: .token-pegged, enabled: true }
        { extension: .dao-treasury, enabled: true }
        { extension: .reputation-registry, enabled: true }
        { extension: .auto-micro-payout, enabled: true }
        { extension: .treasury-proposals, enabled: true }
        { extension: .upgrade-to-free-floating, enabled: true }
      )
    ))

    ;; 2. Configure the pegged token
    (try! (contract-call? .token-pegged initialize
      TOKEN_NAME
      TOKEN_SYMBOL
      ENTRANCE_TAX
      .dao-treasury
    ))

    ;; 3. Set DAO name
    (try! (contract-call? .dao-pegged set-dao-name DAO_NAME))
    (try! (contract-call? .dao-pegged mark-initialized))

    ;; 4. Allow sBTC in treasury
    (try! (contract-call? .dao-treasury allow-asset .mock-sbtc true))
    ;; Also allow the pegged token itself
    (try! (contract-call? .dao-treasury allow-asset .token-pegged true))

    ;; 5. Configure micro-payout amounts (verified work types only)
    (try! (contract-call? .auto-micro-payout set-payout-amount u1 PAYOUT_CHECKIN))
    (try! (contract-call? .auto-micro-payout set-payout-amount u2 PAYOUT_PROOF))

    ;; 6. Seed reputation registry with deployer as founding agent
    (try! (contract-call? .reputation-registry set-reputation sender u100))

    (print {
      notification: "init-pegged-dao/executed",
      payload: {
        dao-name: DAO_NAME,
        token-name: TOKEN_NAME,
        entrance-tax: ENTRANCE_TAX,
        founding-agent: sender
      }
    })
    (ok true)
  )
)
