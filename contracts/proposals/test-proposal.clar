;; title: test-proposal
;; version: 1.0.0
;; summary: A simple test proposal for testing core-proposals extension

(impl-trait .dao-traits.proposal)

;; Track whether this proposal was executed
(define-data-var executed bool false)

;; Execute the proposal
(define-public (execute (sender principal))
  (begin
    (var-set executed true)
    (print {
      notification: "test-proposal/execute",
      payload: {
        sender: sender
      }
    })
    (ok true)
  )
)

;; Check if proposal was executed
(define-read-only (was-executed)
  (var-get executed)
)
