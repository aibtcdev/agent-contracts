;; title: init-pegged-dao
;; version: 1.0.0
;; summary: Bootstrap proposal for a pegged agent DAO.
;; description: One-click DAO deployment. Enables all extensions, configures
;; the pegged token with name/symbol/tax, seeds the guardian council,
;; sets up micro-payout amounts, and allows sBTC in treasury.

;; TRAITS
(impl-trait .dao-traits.proposal)

;; CONSTANTS
(define-constant DAO_NAME "Agent DAO")
(define-constant TOKEN_NAME "Agent DAO BTC")
(define-constant TOKEN_SYMBOL "aDAO")
(define-constant ENTRANCE_TAX u100) ;; 1% (100 basis points)

;; Default micro-payout amounts (in sats / smallest sBTC unit)
(define-constant PAYOUT_CHECKIN u100)
(define-constant PAYOUT_X402 u200)
(define-constant PAYOUT_INSCRIPTION u500)
(define-constant PAYOUT_SIGNAL u300)
(define-constant PAYOUT_BOUNTY u500)

(define-public (execute (sender principal))
  (begin
    ;; 1. Enable all extensions
    (try! (contract-call? .base-dao set-extensions
      (list
        { extension: .dao-pegged, enabled: true }
        { extension: .token-pegged, enabled: true }
        { extension: .dao-treasury, enabled: true }
        { extension: .guardian-council, enabled: true }
        { extension: .auto-micro-payout, enabled: true }
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

    ;; 5. Configure micro-payout amounts
    (try! (contract-call? .auto-micro-payout set-payout-amount u1 PAYOUT_CHECKIN))
    (try! (contract-call? .auto-micro-payout set-payout-amount u2 PAYOUT_X402))
    (try! (contract-call? .auto-micro-payout set-payout-amount u3 PAYOUT_INSCRIPTION))
    (try! (contract-call? .auto-micro-payout set-payout-amount u4 PAYOUT_SIGNAL))
    (try! (contract-call? .auto-micro-payout set-payout-amount u5 PAYOUT_BOUNTY))

    ;; 6. Seed guardian council with initial guardians
    ;; In production, these would be the 3-5 highest ERC-8004 reputation agents
    ;; For now, seed with deployer as initial guardian
    (try! (contract-call? .guardian-council add-guardian sender u100))

    (print {
      notification: "init-pegged-dao/executed",
      payload: {
        dao-name: DAO_NAME,
        token-name: TOKEN_NAME,
        entrance-tax: ENTRANCE_TAX,
        guardian: sender
      }
    })
    (ok true)
  )
)
