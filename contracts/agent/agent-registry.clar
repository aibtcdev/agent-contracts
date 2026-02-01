;; title: agent-registry
;; version: 1.0.0
;; summary: Registry for verified agent accounts with template hash verification.
;; description: Tracks approved contract templates and registered agent accounts.
;;              Designed to use contract-hash? when Clarity 4 is available.
;;              Until then, provides manual attestation levels for trust.

;; TRAITS
(impl-trait .dao-traits.extension)

;; CONSTANTS

;; Error codes
(define-constant ERR_NOT_DAO_OR_EXTENSION (err u2000))
(define-constant ERR_TEMPLATE_NOT_FOUND (err u2001))
(define-constant ERR_TEMPLATE_ALREADY_EXISTS (err u2002))
(define-constant ERR_ACCOUNT_NOT_FOUND (err u2003))
(define-constant ERR_ACCOUNT_ALREADY_REGISTERED (err u2004))
(define-constant ERR_INVALID_ATTESTATION_LEVEL (err u2005))
(define-constant ERR_INVALID_PRINCIPAL (err u2006))
(define-constant ERR_ACCOUNT_IS_NOT_CONTRACT (err u2007))
(define-constant ERR_OWNER_MUST_BE_STANDARD (err u2008))
(define-constant ERR_ACCOUNT_ALREADY_ACTIVE (err u2009))
(define-constant ERR_ACCOUNT_ALREADY_INACTIVE (err u2010))

;; Attestation levels
(define-constant ATTESTATION_UNVERIFIED u0)      ;; Default, no verification
(define-constant ATTESTATION_REGISTERED u1)       ;; Registered but not hash-verified
(define-constant ATTESTATION_HASH_VERIFIED u2)    ;; Hash matches approved template (future)
(define-constant ATTESTATION_AUDITED u3)          ;; Manually audited and approved
(define-constant MAX_ATTESTATION_LEVEL u3)

;; Contract details
(define-constant DEPLOYED_BURN_BLOCK burn-block-height)
(define-constant DEPLOYED_STACKS_BLOCK stacks-block-height)
(define-constant SELF (as-contract tx-sender))

;; DATA MAPS

;; Approved template hashes (for future contract-hash? verification)
;; When Clarity 4 is available, agent-accounts can be verified against these hashes
(define-map ApprovedTemplates (buff 32) {
  name: (string-ascii 64),
  version: uint,
  added-at: uint,
  active: bool
})

;; Registered agent accounts
;; Stores ownership, agent address, verification status, and active state
(define-map RegisteredAccounts principal {
  owner: principal,
  agent: principal,
  template-hash: (optional (buff 32)),
  registered-at: uint,
  attestation-level: uint,
  active: bool
})

;; Lookup maps for efficient queries
(define-map OwnerToAccount principal principal)
(define-map AgentToAccount principal principal)

;; PUBLIC FUNCTIONS

;; Extension callback - required by extension trait
(define-public (callback (sender principal) (memo (buff 34)))
  (ok true)
)

;; ============================================================
;; TEMPLATE MANAGEMENT (DAO-governed)
;; ============================================================

;; Add an approved template hash (DAO/extension only)
;; This is used to pre-approve contract templates before Clarity 4
(define-public (add-approved-template (hash (buff 32)) (name (string-ascii 64)) (version uint))
  (begin
    (try! (is-dao-or-extension))
    (asserts!
      (is-none (map-get? ApprovedTemplates hash))
      ERR_TEMPLATE_ALREADY_EXISTS
    )
    (map-insert ApprovedTemplates hash {
      name: name,
      version: version,
      added-at: stacks-block-height,
      active: true
    })
    (print {
      notification: "agent-registry/add-approved-template",
      payload: {
        hash: hash,
        name: name,
        version: version,
        contractCaller: contract-caller,
        txSender: tx-sender
      }
    })
    (ok true)
  )
)

;; Remove an approved template hash (set inactive)
(define-public (remove-approved-template (hash (buff 32)))
  (let ((template (unwrap! (map-get? ApprovedTemplates hash) ERR_TEMPLATE_NOT_FOUND)))
    (try! (is-dao-or-extension))
    (map-set ApprovedTemplates hash (merge template { active: false }))
    (print {
      notification: "agent-registry/remove-approved-template",
      payload: {
        hash: hash,
        contractCaller: contract-caller,
        txSender: tx-sender
      }
    })
    (ok true)
  )
)

;; ============================================================
;; ACCOUNT REGISTRATION
;; ============================================================

;; Register an agent account (called by the agent-account contract on deploy)
;; The account is contract-caller, owner and agent are provided as params
(define-public (register-agent-account (owner principal) (agent principal))
  (let (
      (account contract-caller)
    )
    ;; Validate that account is a contract (has name component)
    (try! (validate-is-contract account))
    ;; Validate that owner is a standard principal (no contract name)
    (try! (validate-is-standard-principal owner))
    ;; Check not already registered
    (asserts!
      (is-none (map-get? RegisteredAccounts account))
      ERR_ACCOUNT_ALREADY_REGISTERED
    )
    ;; Register the account with attestation level 1 (registered but not hash-verified)
    (map-insert RegisteredAccounts account {
      owner: owner,
      agent: agent,
      template-hash: none,
      registered-at: stacks-block-height,
      attestation-level: ATTESTATION_REGISTERED,
      active: true
    })
    ;; Set up lookup maps
    (map-insert OwnerToAccount owner account)
    (map-insert AgentToAccount agent account)
    (print {
      notification: "agent-registry/register-agent-account",
      payload: {
        account: account,
        owner: owner,
        agent: agent,
        attestationLevel: ATTESTATION_REGISTERED,
        contractCaller: contract-caller,
        txSender: tx-sender
      }
    })
    (ok true)
  )
)

;; ============================================================
;; VERIFICATION FUNCTIONS
;; ============================================================

;; Verify an agent account against approved templates
;; TODO: When Clarity 4 is available, this will use contract-hash?
;;
;; Future implementation:
;; (define-public (verify-agent-account (account principal))
;;   (let (
;;       (hash (try! (contract-hash? account)))
;;       (template (map-get? ApprovedTemplates hash))
;;     )
;;     (match template
;;       t (if (get active t)
;;           (begin
;;             (try! (set-template-hash account hash))
;;             (try! (set-attestation-internal account ATTESTATION_HASH_VERIFIED))
;;             (ok true)
;;           )
;;           (ok false)
;;         )
;;       (ok false)
;;     )
;;   )
;; )
;;
;; For now, returns false and requires manual attestation
(define-public (verify-agent-account (account principal))
  (begin
    ;; Placeholder - contract-hash? not available in Clarity 3
    ;; In production Clarity 4, this would verify the contract hash
    (print {
      notification: "agent-registry/verify-agent-account",
      payload: {
        account: account,
        result: "contract-hash-not-available",
        message: "Clarity 4 required for hash verification"
      }
    })
    (ok false)
  )
)

;; Set attestation level manually (DAO/extension only)
;; Used for manual audits or when contract-hash? is not available
(define-public (set-attestation-level (account principal) (level uint))
  (let ((account-info (unwrap! (map-get? RegisteredAccounts account) ERR_ACCOUNT_NOT_FOUND)))
    (try! (is-dao-or-extension))
    (asserts! (<= level MAX_ATTESTATION_LEVEL) ERR_INVALID_ATTESTATION_LEVEL)
    (map-set RegisteredAccounts account (merge account-info { attestation-level: level }))
    (print {
      notification: "agent-registry/set-attestation-level",
      payload: {
        account: account,
        previousLevel: (get attestation-level account-info),
        newLevel: level,
        contractCaller: contract-caller,
        txSender: tx-sender
      }
    })
    (ok true)
  )
)

;; Set template hash for an account (DAO/extension only)
;; This is for when we know the hash but can't use contract-hash? yet
(define-public (set-template-hash (account principal) (hash (buff 32)))
  (let ((account-info (unwrap! (map-get? RegisteredAccounts account) ERR_ACCOUNT_NOT_FOUND)))
    (try! (is-dao-or-extension))
    ;; Verify the template hash is approved
    (asserts!
      (is-approved-template hash)
      ERR_TEMPLATE_NOT_FOUND
    )
    (map-set RegisteredAccounts account (merge account-info { template-hash: (some hash) }))
    (print {
      notification: "agent-registry/set-template-hash",
      payload: {
        account: account,
        templateHash: hash,
        contractCaller: contract-caller,
        txSender: tx-sender
      }
    })
    (ok true)
  )
)

;; ============================================================
;; AGENT ACTIVATION MANAGEMENT
;; ============================================================

;; Deactivate an agent account (DAO/extension only)
(define-public (deactivate-agent (account principal))
  (let ((account-info (unwrap! (map-get? RegisteredAccounts account) ERR_ACCOUNT_NOT_FOUND)))
    (try! (is-dao-or-extension))
    (asserts! (get active account-info) ERR_ACCOUNT_ALREADY_INACTIVE)
    (map-set RegisteredAccounts account (merge account-info { active: false }))
    (print {
      notification: "agent-registry/deactivate-agent",
      payload: {
        account: account,
        contractCaller: contract-caller,
        txSender: tx-sender
      }
    })
    (ok true)
  )
)

;; Reactivate an agent account (DAO/extension only)
(define-public (reactivate-agent (account principal))
  (let ((account-info (unwrap! (map-get? RegisteredAccounts account) ERR_ACCOUNT_NOT_FOUND)))
    (try! (is-dao-or-extension))
    (asserts! (not (get active account-info)) ERR_ACCOUNT_ALREADY_ACTIVE)
    (map-set RegisteredAccounts account (merge account-info { active: true }))
    (print {
      notification: "agent-registry/reactivate-agent",
      payload: {
        account: account,
        contractCaller: contract-caller,
        txSender: tx-sender
      }
    })
    (ok true)
  )
)

;; ============================================================
;; READ-ONLY FUNCTIONS
;; ============================================================

;; Get account information
(define-read-only (get-account-info (account principal))
  (map-get? RegisteredAccounts account)
)

;; Check if account is registered
(define-read-only (is-registered-account (account principal))
  (is-some (map-get? RegisteredAccounts account))
)

;; Check if account is verified (attestation level >= hash-verified)
(define-read-only (is-verified-account (account principal))
  (match (map-get? RegisteredAccounts account)
    info (>= (get attestation-level info) ATTESTATION_HASH_VERIFIED)
    false
  )
)

;; Check if account meets minimum attestation level
(define-read-only (is-attested-account (account principal) (min-level uint))
  (match (map-get? RegisteredAccounts account)
    info (>= (get attestation-level info) min-level)
    false
  )
)

;; Check if agent account is active
(define-read-only (is-active-agent (account principal))
  (match (map-get? RegisteredAccounts account)
    info (get active info)
    false
  )
)

;; Get attestation level for an account
(define-read-only (get-attestation-level (account principal))
  (match (map-get? RegisteredAccounts account)
    info (some (get attestation-level info))
    none
  )
)

;; Get account by owner
(define-read-only (get-account-by-owner (owner principal))
  (map-get? OwnerToAccount owner)
)

;; Get account by agent
(define-read-only (get-account-by-agent (agent principal))
  (map-get? AgentToAccount agent)
)

;; Check if template hash is approved and active
(define-read-only (is-approved-template (hash (buff 32)))
  (match (map-get? ApprovedTemplates hash)
    template (get active template)
    false
  )
)

;; Get template information
(define-read-only (get-template-info (hash (buff 32)))
  (map-get? ApprovedTemplates hash)
)

;; Get contract info
(define-read-only (get-contract-info)
  {
    self: SELF,
    deployedBurnBlock: DEPLOYED_BURN_BLOCK,
    deployedStacksBlock: DEPLOYED_STACKS_BLOCK,
    maxAttestationLevel: MAX_ATTESTATION_LEVEL
  }
)

;; ============================================================
;; PRIVATE FUNCTIONS
;; ============================================================

;; Authorization check: is caller the DAO or an enabled extension?
(define-private (is-dao-or-extension)
  (ok (asserts!
    (or
      (is-eq tx-sender .base-dao)
      (contract-call? .base-dao is-extension contract-caller)
    )
    ERR_NOT_DAO_OR_EXTENSION
  ))
)

;; Validate that a principal is a contract (has contract name)
(define-private (validate-is-contract (p principal))
  (let ((parts (unwrap! (principal-destruct? p) ERR_INVALID_PRINCIPAL)))
    (asserts! (is-some (get name parts)) ERR_ACCOUNT_IS_NOT_CONTRACT)
    (ok true)
  )
)

;; Validate that a principal is a standard principal (no contract name)
(define-private (validate-is-standard-principal (p principal))
  (let ((parts (unwrap! (principal-destruct? p) ERR_INVALID_PRINCIPAL)))
    (asserts! (is-none (get name parts)) ERR_OWNER_MUST_BE_STANDARD)
    (ok true)
  )
)
