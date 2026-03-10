;; title: reputation-registry
;; version: 1.0.0
;; summary: Reputation registry for pegged agent DAOs.
;; description: Manages reputation scores for all DAO members. Replaces the
;; guardian council's reputation management with a clean, standalone registry.
;; Scores are updated only via DAO proposals (is-dao-or-extension auth).
;; No privileged actors - just a data store governed by the DAO.

;; TRAITS
(impl-trait .dao-traits.extension)

;; CONSTANTS
(define-constant MIN_REPUTATION u1)

;; Error codes (6100 range - reuses guardian-council range since it's gone)
(define-constant ERR_NOT_AUTHORIZED (err u6100))
(define-constant ERR_ZERO_REPUTATION (err u6110))

;; DATA VARS
(define-data-var total-reputation uint u0)
(define-data-var member-count uint u0)

;; DATA MAPS
(define-map ReputationScores principal uint)

;; ============================================================
;; EXTENSION CALLBACK
;; ============================================================

(define-public (callback (sender principal) (memo (buff 34)))
  (ok true)
)

;; ============================================================
;; REPUTATION MANAGEMENT (DAO-only)
;; ============================================================

;; Set reputation for a member (add or update)
(define-public (set-reputation (agent principal) (score uint))
  (let
    (
      (existing (default-to u0 (map-get? ReputationScores agent)))
    )
    (try! (is-dao-or-extension))
    (asserts! (>= score MIN_REPUTATION) ERR_ZERO_REPUTATION)
    ;; Update total reputation
    (if (is-eq existing u0)
      ;; New member
      (begin
        (var-set member-count (+ (var-get member-count) u1))
        (var-set total-reputation (+ (var-get total-reputation) score))
      )
      ;; Existing member - adjust delta
      (var-set total-reputation (+ (- (var-get total-reputation) existing) score))
    )
    (map-set ReputationScores agent score)
    (print {
      notification: "reputation-registry/set-reputation",
      payload: { agent: agent, score: score, previous: existing }
    })
    (ok true)
  )
)

;; Remove a member's reputation entirely
(define-public (remove-reputation (agent principal))
  (let
    (
      (existing (default-to u0 (map-get? ReputationScores agent)))
    )
    (try! (is-dao-or-extension))
    (asserts! (> existing u0) ERR_ZERO_REPUTATION)
    (map-delete ReputationScores agent)
    (var-set total-reputation (- (var-get total-reputation) existing))
    (var-set member-count (- (var-get member-count) u1))
    (print {
      notification: "reputation-registry/remove-reputation",
      payload: { agent: agent, previous: existing }
    })
    (ok true)
  )
)

;; ============================================================
;; READ-ONLY FUNCTIONS
;; ============================================================

(define-read-only (get-reputation (agent principal))
  (default-to u0 (map-get? ReputationScores agent))
)

(define-read-only (get-total-reputation)
  (var-get total-reputation)
)

(define-read-only (get-member-count)
  (var-get member-count)
)

(define-read-only (has-reputation (agent principal))
  (> (default-to u0 (map-get? ReputationScores agent)) u0)
)

;; ============================================================
;; PRIVATE FUNCTIONS
;; ============================================================

(define-private (is-dao-or-extension)
  (ok (asserts!
    (or
      (is-eq tx-sender .base-dao)
      (contract-call? .base-dao is-extension contract-caller)
    )
    ERR_NOT_AUTHORIZED
  ))
)
