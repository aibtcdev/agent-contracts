;; title: dao-pegged
;; version: 1.0.0
;; summary: Main orchestrator for pegged agent DAOs.
;; description: A simplified DAO entry point that wraps base-dao with
;; agent-friendly deploy and configuration. Manages the lifecycle from
;; Phase 1 (pegged, guardian council) to Phase 2 (free-floating, token-weighted).
;; One-click deploy via construct with name and entrance tax rate.

;; TRAITS
(impl-trait .dao-traits.extension)

;; CONSTANTS
(define-constant SELF (as-contract tx-sender))
(define-constant DEPLOYER tx-sender)

;; Error codes (6400 range)
(define-constant ERR_NOT_AUTHORIZED (err u6400))
(define-constant ERR_ALREADY_INITIALIZED (err u6401))

;; DATA VARS
(define-data-var dao-name (string-ascii 64) "Agent DAO")
(define-data-var phase uint u1) ;; 1 = pegged, 2 = free-floating
(define-data-var initialized bool false)
(define-data-var deployer-principal principal DEPLOYER)

;; ============================================================
;; EXTENSION CALLBACK
;; ============================================================

(define-public (callback (sender principal) (memo (buff 34)))
  (ok true)
)

;; ============================================================
;; INITIALIZATION (called by init proposal)
;; ============================================================

;; Set DAO metadata during construction
(define-public (set-dao-name (name (string-ascii 64)))
  (begin
    (try! (is-dao-or-extension))
    (var-set dao-name name)
    (print {
      notification: "dao-pegged/set-name",
      payload: { name: name }
    })
    (ok true)
  )
)

;; Mark as initialized
(define-public (mark-initialized)
  (begin
    (try! (is-dao-or-extension))
    (asserts! (not (var-get initialized)) ERR_ALREADY_INITIALIZED)
    (var-set initialized true)
    (print {
      notification: "dao-pegged/initialized",
      payload: {
        name: (var-get dao-name),
        phase: (var-get phase),
        deployer: (var-get deployer-principal)
      }
    })
    (ok true)
  )
)

;; ============================================================
;; PHASE MANAGEMENT
;; ============================================================

;; Advance to Phase 2 (called by upgrade-to-free-floating on successful vote)
(define-public (set-phase (new-phase uint))
  (begin
    (try! (is-dao-or-extension))
    (var-set phase new-phase)
    (print {
      notification: "dao-pegged/phase-change",
      payload: { phase: new-phase }
    })
    (ok true)
  )
)

;; ============================================================
;; READ-ONLY FUNCTIONS
;; ============================================================

(define-read-only (get-dao-name)
  (var-get dao-name)
)

(define-read-only (get-phase)
  (var-get phase)
)

(define-read-only (is-phase-1)
  (is-eq (var-get phase) u1)
)

(define-read-only (is-phase-2)
  (is-eq (var-get phase) u2)
)

(define-read-only (is-initialized)
  (var-get initialized)
)

(define-read-only (get-dao-info)
  {
    name: (var-get dao-name),
    phase: (var-get phase),
    initialized: (var-get initialized),
    deployer: (var-get deployer-principal)
  }
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
