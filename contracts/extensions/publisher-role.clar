;; title: publisher-role
;; version: 1.0.0
;; summary: Monarch extension -- stores the current publisher's agent-id
;; and resolves their wallet via ERC-8004 identity registry.
;; description: The publisher is the single authority who controls the
;; AIBTC News treasury and editorial decisions. They're identified by
;; their ERC-8004 agent-id (stable), not their wallet address (rotatable).
;; Treasury is frozen during active governance proposals to prevent
;; draining before votes conclude. Publisher can be replaced via the
;; governance contract's three-phase voting process.

(impl-trait .dao-traits.extension)

;; =========================================
;; CONSTANTS
;; =========================================

(define-constant ERR_NOT_AUTHORIZED (err u3000))
(define-constant ERR_NOT_PUBLISHER (err u3001))
(define-constant ERR_TREASURY_FROZEN (err u3002))
(define-constant ERR_INVALID_AGENT_ID (err u3003))
(define-constant ERR_WALLET_NOT_FOUND (err u3004))

;; =========================================
;; DATA VARS
;; =========================================

;; Publisher identified by ERC-8004 agent-id (uint)
;; If publisher rotates wallet, DAO follows automatically via registry lookup
(define-data-var publisher-agent-id uint u0)

;; Treasury freeze flag -- set true when a governance proposal is active
(define-data-var is-vote-active bool false)

;; Bond amount in sBTC sats required to create a proposal (0.1 sBTC = 10000000 sats)
(define-data-var proposal-bond uint u10000000)

;; =========================================
;; PUBLIC FUNCTIONS
;; =========================================

;; Extension callback (required by trait)
(define-public (callback (sender principal) (memo (buff 34)))
  (ok true)
)

;; @desc Spend from treasury. Publisher-only, blocked during active votes.
;; @param amount - sBTC sats to send
;; @param recipient - destination principal
;; @returns (response bool uint)
(define-public (spend (amount uint) (recipient principal))
  (begin
    (asserts! (not (var-get is-vote-active)) ERR_TREASURY_FROZEN)
    (asserts! (is-publisher tx-sender) ERR_NOT_PUBLISHER)
    ;; Record publisher liveness
    (try! (contract-call? .heartbeat beat tx-sender))
    (print {
      notification: "publisher-role/spend",
      payload: {
        publisher: tx-sender,
        amount: amount,
        recipient: recipient
      }
    })
    ;; Withdraw from DAO treasury
    (contract-call? .dao-treasury withdraw-ft
      .mock-sbtc
      amount recipient)
  )
)

;; @desc Freeze treasury (called by governance when a proposal is created).
;; DAO-only.
(define-public (freeze-treasury)
  (begin
    (try! (is-dao-or-extension))
    (var-set is-vote-active true)
    (print {
      notification: "publisher-role/freeze-treasury",
      payload: { frozen: true }
    })
    (ok true)
  )
)

;; @desc Unfreeze treasury (called by governance after proposal concludes).
;; DAO-only.
(define-public (unfreeze-treasury)
  (begin
    (try! (is-dao-or-extension))
    (var-set is-vote-active false)
    (print {
      notification: "publisher-role/unfreeze-treasury",
      payload: { frozen: false }
    })
    (ok true)
  )
)

;; @desc Set publisher agent-id. DAO-only (called by governance after
;; a successful publisher replacement vote, or by init-proposal at bootstrap).
;; @param new-agent-id - ERC-8004 agent-id of the new publisher
(define-public (set-publisher (new-agent-id uint))
  (begin
    (try! (is-dao-or-extension))
    (asserts! (> new-agent-id u0) ERR_INVALID_AGENT_ID)
    (let
      (
        (old-id (var-get publisher-agent-id))
      )
      (var-set publisher-agent-id new-agent-id)
      (print {
        notification: "publisher-role/set-publisher",
        payload: {
          previous-agent-id: old-id,
          new-agent-id: new-agent-id
        }
      })
      (ok true)
    )
  )
)

;; @desc Update proposal bond amount. DAO-only.
;; @param new-bond - bond in sBTC sats
(define-public (set-bond (new-bond uint))
  (begin
    (try! (is-dao-or-extension))
    (var-set proposal-bond new-bond)
    (ok true)
  )
)

;; =========================================
;; READ-ONLY FUNCTIONS
;; =========================================

;; @desc Get the current publisher's agent-id
(define-read-only (get-publisher-agent-id)
  (var-get publisher-agent-id)
)

;; @desc Resolve the publisher's current wallet via ERC-8004 identity registry.
;; If the publisher rotated their wallet, this returns the new one automatically.
;; NOTE: In production, replace .mock-identity-registry with
;; 'SP1NMR7MY0TJ1QA7WQBZ6504KC79PZNTRQH4YGFJD.identity-registry-v2
(define-read-only (get-publisher-wallet)
  (contract-call? .mock-identity-registry
    get-agent-wallet (var-get publisher-agent-id))
)

;; @desc Check if a principal is the current publisher
;; Resolves agent-id -> wallet via ERC-8004, then compares
(define-read-only (is-publisher (who principal))
  (match (get-publisher-wallet)
    wallet (is-eq who wallet)
    false
  )
)

;; @desc Check if the treasury is currently frozen
(define-read-only (is-frozen)
  (var-get is-vote-active)
)

;; @desc Get the current proposal bond amount
(define-read-only (get-bond)
  (var-get proposal-bond)
)

;; =========================================
;; PRIVATE FUNCTIONS
;; =========================================

(define-private (is-dao-or-extension)
  (ok (asserts!
    (or
      (is-eq contract-caller .base-dao)
      (contract-call? .base-dao is-extension contract-caller)
    )
    ERR_NOT_AUTHORIZED
  ))
)
