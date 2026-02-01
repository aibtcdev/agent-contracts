;; title: base-dao
;; version: 1.0.0
;; summary: ExecutorDAO implementation with version-based RBAC for agent DAOs

;; TRAITS
(use-trait proposal-trait .dao-traits.proposal)
(use-trait extension-trait .dao-traits.extension)

;; CONSTANTS

(define-constant ERR_UNAUTHORIZED (err u1000))
(define-constant ERR_ALREADY_EXECUTED (err u1001))
(define-constant ERR_INVALID_EXTENSION (err u1002))
(define-constant ERR_NO_EMPTY_LISTS (err u1003))
(define-constant ERR_DAO_ALREADY_CONSTRUCTED (err u1004))

;; DATA VARS

;; Used for initial construction, set to contract itself after
(define-data-var executive principal tx-sender)
;; Tracks whether DAO has been initialized
(define-data-var constructed bool false)
;; Version-based RBAC: extensions can check minimum version requirements
(define-data-var dao-version uint u1)

;; DATA MAPS

;; Tracks block height of executed proposals
(define-map ExecutedProposals principal uint)
;; Tracks enabled status of extensions
(define-map Extensions principal bool)

;; PUBLIC FUNCTIONS

;; Initial construction of the DAO - can only be called once
(define-public (construct (proposal <proposal-trait>))
  (let ((sender tx-sender))
    (asserts! (not (var-get constructed)) ERR_DAO_ALREADY_CONSTRUCTED)
    (asserts! (is-eq sender (var-get executive)) ERR_UNAUTHORIZED)
    (var-set constructed true)
    (var-set executive (as-contract tx-sender))
    (print {
      notification: "base-dao/construct",
      payload: {
        proposal: (contract-of proposal),
        sender: sender
      }
    })
    (as-contract (execute proposal sender))
  )
)

;; Execute Clarity code in a proposal
(define-public (execute (proposal <proposal-trait>) (sender principal))
  (begin
    (try! (is-self-or-extension))
    (asserts!
      (map-insert ExecutedProposals (contract-of proposal) stacks-block-height)
      ERR_ALREADY_EXECUTED
    )
    (print {
      notification: "base-dao/execute",
      payload: {
        proposal: (contract-of proposal),
        sender: sender
      }
    })
    (as-contract (contract-call? proposal execute sender))
  )
)

;; Add an extension or update the status of an existing one
(define-public (set-extension (extension principal) (enabled bool))
  (begin
    (try! (is-self-or-extension))
    (print {
      notification: "base-dao/set-extension",
      payload: {
        extension: extension,
        enabled: enabled
      }
    })
    (ok (map-set Extensions extension enabled))
  )
)

;; Add multiple extensions or update the status of existing ones
(define-public (set-extensions (extension-list (list 200 {extension: principal, enabled: bool})))
  (begin
    (try! (is-self-or-extension))
    (asserts! (> (len extension-list) u0) ERR_NO_EMPTY_LISTS)
    (ok (map set-extensions-iter extension-list))
  )
)

;; Request a callback from an extension
(define-public (request-extension-callback (extension <extension-trait>) (memo (buff 34)))
  (let ((sender tx-sender))
    (asserts! (is-extension contract-caller) ERR_INVALID_EXTENSION)
    (asserts! (is-eq contract-caller (contract-of extension)) ERR_INVALID_EXTENSION)
    (print {
      notification: "base-dao/request-extension-callback",
      payload: {
        extension: (contract-of extension),
        memo: memo,
        sender: sender
      }
    })
    (as-contract (contract-call? extension callback sender memo))
  )
)

;; Increment the DAO version - used for RBAC milestone tracking
;; Only callable by DAO itself or enabled extensions
(define-public (increment-version)
  (begin
    (try! (is-self-or-extension))
    (var-set dao-version (+ (var-get dao-version) u1))
    (print {
      notification: "base-dao/increment-version",
      payload: {
        new-version: (var-get dao-version)
      }
    })
    (ok (var-get dao-version))
  )
)

;; READ-ONLY FUNCTIONS

;; Check if DAO has been constructed
(define-read-only (is-constructed)
  (var-get constructed)
)

;; Check if a principal is an enabled extension
(define-read-only (is-extension (extension principal))
  (default-to false (map-get? Extensions extension))
)

;; Get the block height at which a proposal was executed
(define-read-only (executed-at (proposal principal))
  (map-get? ExecutedProposals proposal)
)

;; Get the current DAO version for RBAC checks
(define-read-only (get-version)
  (var-get dao-version)
)

;; PRIVATE FUNCTIONS

;; Authorization check: is caller the DAO itself or an enabled extension?
(define-private (is-self-or-extension)
  (ok (asserts!
    (or
      (is-eq tx-sender (as-contract tx-sender))
      (is-extension contract-caller)
    )
    ERR_UNAUTHORIZED
  ))
)

;; Helper for set-extensions iteration
(define-private (set-extensions-iter (item {extension: principal, enabled: bool}))
  (begin
    (print {
      notification: "base-dao/set-extension",
      payload: {
        extension: (get extension item),
        enabled: (get enabled item)
      }
    })
    (map-set Extensions (get extension item) (get enabled item))
  )
)
