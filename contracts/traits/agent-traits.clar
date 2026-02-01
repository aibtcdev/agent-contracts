;; title: agent-traits
;; version: 1.0.0
;; summary: Trait definitions for agent accounts and registry.

;; IMPORTS
(use-trait ft-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
(use-trait dao-proposal-trait .dao-traits.proposal)
(use-trait dao-core-proposals-trait .dao-traits.core-proposals)

;; ============================================================
;; AGENT ACCOUNT TRAITS
;; ============================================================

;; Core agent account interface for user-agent wallet operations.
;; Allows deposits, withdrawals, and basic asset management.
(define-trait agent-account (
  ;; Deposit STX into the agent account
  (deposit-stx
    (uint)
    (response bool uint)
  )
  ;; Deposit fungible tokens into the agent account
  (deposit-ft
    (<ft-trait> uint)
    (response bool uint)
  )
  ;; Withdraw STX from the agent account (owner only)
  (withdraw-stx
    (uint)
    (response bool uint)
  )
  ;; Withdraw fungible tokens from the agent account (owner only)
  (withdraw-ft
    (<ft-trait> uint)
    (response bool uint)
  )
))

;; Agent account proposal capabilities.
;; Allows agents to interact with DAO governance on behalf of users.
(define-trait agent-account-proposals (
  ;; Create a proposal through the agent account
  (create-proposal
    (<dao-core-proposals-trait> <dao-proposal-trait> (optional (string-ascii 1024)))
    (response uint uint)
  )
  ;; Vote on a proposal through the agent account
  (vote-on-proposal
    (<dao-core-proposals-trait> uint bool)
    (response bool uint)
  )
  ;; Conclude a proposal through the agent account
  (conclude-proposal
    (<dao-core-proposals-trait> uint <dao-proposal-trait>)
    (response bool uint)
  )
))

;; Agent account configuration interface.
;; Controls what actions the agent can perform on behalf of the user.
(define-trait agent-account-config (
  ;; Toggle agent's ability to manage assets (deposit/withdraw)
  (set-agent-can-manage-assets
    (bool)
    (response bool uint)
  )
  ;; Toggle agent's ability to use proposal functions
  (set-agent-can-use-proposals
    (bool)
    (response bool uint)
  )
  ;; Get the current configuration of the agent account
  (get-config
    ()
    (response
      {
        account: principal,
        agent: principal,
        owner: principal,
        agent-can-manage-assets: bool,
        agent-can-use-proposals: bool
      }
      uint
    )
  )
))

;; ============================================================
;; AGENT REGISTRY TRAIT
;; ============================================================

;; Registry for verified agents in the ecosystem.
;; Allows DAOs to verify and trust specific agent principals.
(define-trait agent-registry (
  ;; Register a new agent (requires fee/stake)
  (register-agent
    ((string-ascii 64) (string-utf8 256))
    (response bool uint)
  )
  ;; Check if an agent is registered and active
  (is-registered-agent
    (principal)
    (response bool uint)
  )
  ;; Get agent information
  (get-agent-info
    (principal)
    (response
      {
        name: (string-ascii 64),
        description: (string-utf8 256),
        registered-at: uint,
        active: bool
      }
      uint
    )
  )
  ;; Deactivate an agent (self or governance)
  (deactivate-agent
    (principal)
    (response bool uint)
  )
))
