;; title: mock-identity-registry
;; version: 1.0.0
;; summary: Mock ERC-8004 identity registry for testing.
;; In production, publisher-role.clar calls the real
;; SP1NMR7MY0TJ1QA7WQBZ6504KC79PZNTRQH4YGFJD.identity-registry-v2

(define-map agent-wallets uint principal)
(define-data-var next-id uint u1)

;; Register an agent and return their agent-id
(define-public (register-agent (wallet principal))
  (let
    (
      (id (var-get next-id))
    )
    (map-set agent-wallets id wallet)
    (var-set next-id (+ id u1))
    (ok id)
  )
)

;; Set wallet for an existing agent-id (for rotation testing)
(define-public (set-agent-wallet (agent-id uint) (wallet principal))
  (begin
    (map-set agent-wallets agent-id wallet)
    (ok true)
  )
)

;; Read-only: resolve agent-id to wallet
(define-read-only (get-agent-wallet (agent-id uint))
  (map-get? agent-wallets agent-id)
)
