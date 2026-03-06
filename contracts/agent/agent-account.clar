;; title: agent-account
;; version: 2.0.0
;; summary: A user-agent account contract for managing assets and DAO interactions.
;; description: Deploy identical code, initialize once with owner and agent principals.
;;              Same source code produces same contract-hash for registry verification.
;;              The owner has full access; the agent can perform allowed actions.
;;              Funds are always withdrawn to the owner address.

;; TRAITS
(impl-trait .agent-traits.agent-account)
(impl-trait .agent-traits.agent-account-proposals)
(impl-trait .agent-traits.agent-account-config)

(use-trait ft-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
(use-trait dao-proposal-trait .dao-traits.proposal)
(use-trait dao-core-proposals-trait .dao-traits.core-proposals)

;; CONSTANTS

;; Deployment info
(define-constant DEPLOYED_BURN_BLOCK burn-block-height)
(define-constant DEPLOYED_STACKS_BLOCK stacks-block-height)
(define-constant SELF (as-contract tx-sender))
(define-constant DEPLOYER tx-sender)

;; Error codes
(define-constant ERR_CALLER_NOT_OWNER (err u4000))
(define-constant ERR_OPERATION_NOT_ALLOWED (err u4001))
(define-constant ERR_CONTRACT_NOT_APPROVED (err u4002))
(define-constant ERR_INVALID_APPROVAL_TYPE (err u4003))
(define-constant ERR_ZERO_AMOUNT (err u4004))
(define-constant ERR_ALREADY_INITIALIZED (err u4005))
(define-constant ERR_NOT_INITIALIZED (err u4006))

;; Permission flags (bit-based)
(define-constant PERMISSION_MANAGE_ASSETS (pow u2 u0))            ;; 1
(define-constant PERMISSION_USE_PROPOSALS (pow u2 u1))            ;; 2
(define-constant PERMISSION_APPROVE_REVOKE_CONTRACTS (pow u2 u2)) ;; 4
(define-constant PERMISSION_BUY_SELL_ASSETS (pow u2 u3))          ;; 8

;; Default permissions: manage assets + use proposals + approve/revoke contracts (7)
(define-constant DEFAULT_PERMISSIONS (+
  PERMISSION_MANAGE_ASSETS
  PERMISSION_USE_PROPOSALS
  PERMISSION_APPROVE_REVOKE_CONTRACTS
))

;; Contract approval types
(define-constant APPROVED_CONTRACT_VOTING u1)
(define-constant APPROVED_CONTRACT_SWAP u2)
(define-constant APPROVED_CONTRACT_TOKEN u3)

;; DATA MAPS

;; Approved contracts by type
(define-map ApprovedContracts { contract: principal, type: uint } bool)

;; DATA VARS

;; Account configuration (set once via initialize)
(define-data-var initialized bool false)
(define-data-var account-owner (optional principal) none)
(define-data-var account-agent (optional principal) none)

;; Current agent permissions (can be modified by owner)
(define-data-var agentPermissions uint DEFAULT_PERMISSIONS)

;; PUBLIC FUNCTIONS

;; ============================================================
;; INITIALIZATION (deployer only, one-time)
;; ============================================================

(define-public (initialize (owner principal) (agent principal))
  (begin
    (asserts! (is-eq tx-sender DEPLOYER) ERR_CALLER_NOT_OWNER)
    (asserts! (not (var-get initialized)) ERR_ALREADY_INITIALIZED)
    (var-set account-owner (some owner))
    (var-set account-agent (some agent))
    (var-set initialized true)
    (print {
      notification: "agent-account/initialized",
      payload: {
        account: SELF,
        owner: owner,
        agent: agent,
        deployer: DEPLOYER
      }
    })
    (ok true)
  )
)

;; ============================================================
;; ASSET MANAGEMENT
;; ============================================================

;; Deposit STX to the agent account
(define-public (deposit-stx (amount uint))
  (begin
    (asserts! (var-get initialized) ERR_NOT_INITIALIZED)
    (asserts! (> amount u0) ERR_ZERO_AMOUNT)
    (asserts! (manage-assets-allowed) ERR_OPERATION_NOT_ALLOWED)
    (print {
      notification: "agent-account/deposit-stx",
      payload: {
        contractCaller: contract-caller,
        txSender: tx-sender,
        amount: amount,
        recipient: SELF
      }
    })
    (stx-transfer? amount contract-caller SELF)
  )
)

;; Deposit fungible tokens to the agent account
(define-public (deposit-ft (ft <ft-trait>) (amount uint))
  (begin
    (asserts! (var-get initialized) ERR_NOT_INITIALIZED)
    (asserts! (> amount u0) ERR_ZERO_AMOUNT)
    (asserts! (manage-assets-allowed) ERR_OPERATION_NOT_ALLOWED)
    (print {
      notification: "agent-account/deposit-ft",
      payload: {
        amount: amount,
        assetContract: (contract-of ft),
        txSender: tx-sender,
        contractCaller: contract-caller,
        recipient: SELF
      }
    })
    (contract-call? ft transfer amount contract-caller SELF none)
  )
)

;; Withdraw STX from the agent account (always to owner)
(define-public (withdraw-stx (amount uint))
  (let ((owner (unwrap! (var-get account-owner) ERR_NOT_INITIALIZED)))
    (asserts! (> amount u0) ERR_ZERO_AMOUNT)
    (asserts! (manage-assets-allowed) ERR_OPERATION_NOT_ALLOWED)
    (print {
      notification: "agent-account/withdraw-stx",
      payload: {
        amount: amount,
        sender: SELF,
        caller: contract-caller,
        recipient: owner
      }
    })
    (as-contract (stx-transfer? amount SELF owner))
  )
)

;; Withdraw fungible tokens from the agent account (always to owner)
;; Token must be approved
(define-public (withdraw-ft (ft <ft-trait>) (amount uint))
  (let ((owner (unwrap! (var-get account-owner) ERR_NOT_INITIALIZED)))
    (asserts! (> amount u0) ERR_ZERO_AMOUNT)
    (asserts! (manage-assets-allowed) ERR_OPERATION_NOT_ALLOWED)
    (asserts! (is-approved-contract (contract-of ft) APPROVED_CONTRACT_TOKEN)
      ERR_CONTRACT_NOT_APPROVED
    )
    (print {
      notification: "agent-account/withdraw-ft",
      payload: {
        amount: amount,
        assetContract: (contract-of ft),
        sender: SELF,
        caller: contract-caller,
        recipient: owner
      }
    })
    (as-contract (contract-call? ft transfer amount SELF owner none))
  )
)

;; ============================================================
;; PROPOSAL INTERACTION
;; ============================================================

;; Create a proposal through an approved voting contract
(define-public (create-proposal
    (votingContract <dao-core-proposals-trait>)
    (proposal <dao-proposal-trait>)
    (memo (optional (string-ascii 1024)))
  )
  (begin
    (asserts! (var-get initialized) ERR_NOT_INITIALIZED)
    (asserts! (use-proposals-allowed) ERR_OPERATION_NOT_ALLOWED)
    (asserts!
      (is-approved-contract (contract-of votingContract) APPROVED_CONTRACT_VOTING)
      ERR_CONTRACT_NOT_APPROVED
    )
    (print {
      notification: "agent-account/create-proposal",
      payload: {
        votingContract: (contract-of votingContract),
        proposal: (contract-of proposal),
        sender: tx-sender,
        caller: contract-caller
      }
    })
    (as-contract (contract-call? votingContract create-proposal proposal memo))
  )
)

;; Vote on a proposal through an approved voting contract
(define-public (vote-on-proposal
    (votingContract <dao-core-proposals-trait>)
    (proposalId uint)
    (vote bool)
  )
  (begin
    (asserts! (var-get initialized) ERR_NOT_INITIALIZED)
    (asserts! (use-proposals-allowed) ERR_OPERATION_NOT_ALLOWED)
    (asserts!
      (is-approved-contract (contract-of votingContract) APPROVED_CONTRACT_VOTING)
      ERR_CONTRACT_NOT_APPROVED
    )
    (print {
      notification: "agent-account/vote-on-proposal",
      payload: {
        votingContract: (contract-of votingContract),
        proposalId: proposalId,
        vote: vote,
        sender: tx-sender,
        caller: contract-caller
      }
    })
    (as-contract (contract-call? votingContract vote-on-proposal proposalId vote))
  )
)

;; Conclude a proposal through an approved voting contract
(define-public (conclude-proposal
    (votingContract <dao-core-proposals-trait>)
    (proposalId uint)
    (proposal <dao-proposal-trait>)
  )
  (begin
    (asserts! (var-get initialized) ERR_NOT_INITIALIZED)
    (asserts! (use-proposals-allowed) ERR_OPERATION_NOT_ALLOWED)
    (asserts!
      (is-approved-contract (contract-of votingContract) APPROVED_CONTRACT_VOTING)
      ERR_CONTRACT_NOT_APPROVED
    )
    (print {
      notification: "agent-account/conclude-proposal",
      payload: {
        votingContract: (contract-of votingContract),
        proposalId: proposalId,
        proposal: (contract-of proposal),
        sender: tx-sender,
        caller: contract-caller
      }
    })
    (as-contract (contract-call? votingContract conclude-proposal proposalId proposal))
  )
)

;; ============================================================
;; CONFIGURATION (owner or agent with permission)
;; ============================================================

;; Approve a contract for use with the agent account
(define-public (approve-contract (contract principal) (type uint))
  (begin
    (asserts! (var-get initialized) ERR_NOT_INITIALIZED)
    (asserts! (is-valid-type type) ERR_INVALID_APPROVAL_TYPE)
    (asserts! (approve-revoke-contract-allowed) ERR_OPERATION_NOT_ALLOWED)
    (print {
      notification: "agent-account/approve-contract",
      payload: {
        contract: contract,
        type: type,
        approved: true,
        sender: tx-sender,
        caller: contract-caller
      }
    })
    (ok (map-set ApprovedContracts { contract: contract, type: type } true))
  )
)

;; Revoke a contract from use with the agent account
(define-public (revoke-contract (contract principal) (type uint))
  (begin
    (asserts! (var-get initialized) ERR_NOT_INITIALIZED)
    (asserts! (is-valid-type type) ERR_INVALID_APPROVAL_TYPE)
    (asserts! (approve-revoke-contract-allowed) ERR_OPERATION_NOT_ALLOWED)
    (print {
      notification: "agent-account/revoke-contract",
      payload: {
        contract: contract,
        type: type,
        approved: false,
        sender: tx-sender,
        caller: contract-caller
      }
    })
    (ok (map-set ApprovedContracts { contract: contract, type: type } false))
  )
)

;; ============================================================
;; PERMISSION CONFIGURATION (owner only)
;; ============================================================

;; Toggle agent's ability to manage assets (deposit/withdraw)
(define-public (set-agent-can-manage-assets (canManage bool))
  (begin
    (asserts! (var-get initialized) ERR_NOT_INITIALIZED)
    (asserts! (is-owner) ERR_CALLER_NOT_OWNER)
    (print {
      notification: "agent-account/set-agent-can-manage-assets",
      payload: {
        canManageAssets: canManage,
        sender: tx-sender,
        caller: contract-caller
      }
    })
    (let ((currentPermissions (var-get agentPermissions)))
      (ok (var-set agentPermissions
        (if canManage
          (bit-or currentPermissions PERMISSION_MANAGE_ASSETS)
          (bit-and currentPermissions (bit-not PERMISSION_MANAGE_ASSETS))
        )
      ))
    )
  )
)

;; Toggle agent's ability to use proposal functions
(define-public (set-agent-can-use-proposals (canUseProposals bool))
  (begin
    (asserts! (var-get initialized) ERR_NOT_INITIALIZED)
    (asserts! (is-owner) ERR_CALLER_NOT_OWNER)
    (print {
      notification: "agent-account/set-agent-can-use-proposals",
      payload: {
        canUseProposals: canUseProposals,
        sender: tx-sender,
        caller: contract-caller
      }
    })
    (let ((currentPermissions (var-get agentPermissions)))
      (ok (var-set agentPermissions
        (if canUseProposals
          (bit-or currentPermissions PERMISSION_USE_PROPOSALS)
          (bit-and currentPermissions (bit-not PERMISSION_USE_PROPOSALS))
        )
      ))
    )
  )
)

;; Toggle agent's ability to approve/revoke contracts
(define-public (set-agent-can-approve-revoke-contracts (canApproveRevoke bool))
  (begin
    (asserts! (var-get initialized) ERR_NOT_INITIALIZED)
    (asserts! (is-owner) ERR_CALLER_NOT_OWNER)
    (print {
      notification: "agent-account/set-agent-can-approve-revoke-contracts",
      payload: {
        canApproveRevokeContracts: canApproveRevoke,
        sender: tx-sender,
        caller: contract-caller
      }
    })
    (let ((currentPermissions (var-get agentPermissions)))
      (ok (var-set agentPermissions
        (if canApproveRevoke
          (bit-or currentPermissions PERMISSION_APPROVE_REVOKE_CONTRACTS)
          (bit-and currentPermissions (bit-not PERMISSION_APPROVE_REVOKE_CONTRACTS))
        )
      ))
    )
  )
)

;; Toggle agent's ability to buy/sell assets
(define-public (set-agent-can-buy-sell-assets (canBuySell bool))
  (begin
    (asserts! (var-get initialized) ERR_NOT_INITIALIZED)
    (asserts! (is-owner) ERR_CALLER_NOT_OWNER)
    (print {
      notification: "agent-account/set-agent-can-buy-sell-assets",
      payload: {
        canBuySell: canBuySell,
        sender: tx-sender,
        caller: contract-caller
      }
    })
    (let ((currentPermissions (var-get agentPermissions)))
      (ok (var-set agentPermissions
        (if canBuySell
          (bit-or currentPermissions PERMISSION_BUY_SELL_ASSETS)
          (bit-and currentPermissions (bit-not PERMISSION_BUY_SELL_ASSETS))
        )
      ))
    )
  )
)

;; Get config (implements trait)
(define-public (get-config)
  (let (
    (owner (unwrap! (var-get account-owner) ERR_NOT_INITIALIZED))
    (agent (unwrap! (var-get account-agent) ERR_NOT_INITIALIZED))
  )
    (ok {
      account: SELF,
      agent: agent,
      owner: owner,
      agent-can-manage-assets: (not (is-eq u0 (bit-and (var-get agentPermissions) PERMISSION_MANAGE_ASSETS))),
      agent-can-use-proposals: (not (is-eq u0 (bit-and (var-get agentPermissions) PERMISSION_USE_PROPOSALS)))
    })
  )
)

;; ============================================================
;; READ-ONLY FUNCTIONS
;; ============================================================

;; Check if a contract is approved for a specific type
(define-read-only (is-approved-contract (contract principal) (type uint))
  (default-to false
    (map-get? ApprovedContracts { contract: contract, type: type })
  )
)

;; Get the full configuration of the agent account
(define-read-only (get-configuration)
  {
    account: SELF,
    owner: (var-get account-owner),
    agent: (var-get account-agent),
    initialized: (var-get initialized),
    deployer: DEPLOYER,
    deployedBurnBlock: DEPLOYED_BURN_BLOCK,
    deployedStacksBlock: DEPLOYED_STACKS_BLOCK
  }
)

;; Get the approval type constants
(define-read-only (get-approval-types)
  {
    voting: APPROVED_CONTRACT_VOTING,
    swap: APPROVED_CONTRACT_SWAP,
    token: APPROVED_CONTRACT_TOKEN
  }
)

;; Get decoded agent permissions
(define-read-only (get-agent-permissions)
  (let ((permissions (var-get agentPermissions)))
    {
      rawPermissions: permissions,
      canManageAssets: (not (is-eq u0 (bit-and permissions PERMISSION_MANAGE_ASSETS))),
      canUseProposals: (not (is-eq u0 (bit-and permissions PERMISSION_USE_PROPOSALS))),
      canApproveRevokeContracts: (not (is-eq u0 (bit-and permissions PERMISSION_APPROVE_REVOKE_CONTRACTS))),
      canBuySellAssets: (not (is-eq u0 (bit-and permissions PERMISSION_BUY_SELL_ASSETS)))
    }
  )
)

;; Get permission flag constants
(define-read-only (get-permission-flags)
  {
    manageAssets: PERMISSION_MANAGE_ASSETS,
    useProposals: PERMISSION_USE_PROPOSALS,
    approveRevokeContracts: PERMISSION_APPROVE_REVOKE_CONTRACTS,
    buySellAssets: PERMISSION_BUY_SELL_ASSETS,
    defaultPermissions: DEFAULT_PERMISSIONS
  }
)

;; ============================================================
;; PRIVATE FUNCTIONS
;; ============================================================

;; Check if caller is the account owner
(define-private (is-owner)
  (match (var-get account-owner)
    owner (is-eq contract-caller owner)
    false
  )
)

;; Check if caller is the authorized agent
(define-private (is-agent)
  (match (var-get account-agent)
    agent (is-eq contract-caller agent)
    false
  )
)

;; Check if contract type is valid
(define-private (is-valid-type (type uint))
  (or
    (is-eq type APPROVED_CONTRACT_VOTING)
    (is-eq type APPROVED_CONTRACT_SWAP)
    (is-eq type APPROVED_CONTRACT_TOKEN)
  )
)

;; Check if managing assets is allowed for the caller
(define-private (manage-assets-allowed)
  (or (is-owner)
      (and (is-agent)
           (not (is-eq u0 (bit-and (var-get agentPermissions) PERMISSION_MANAGE_ASSETS)))))
)

;; Check if using proposals is allowed for the caller
(define-private (use-proposals-allowed)
  (or (is-owner)
      (and (is-agent)
           (not (is-eq u0 (bit-and (var-get agentPermissions) PERMISSION_USE_PROPOSALS)))))
)

;; Check if approving/revoking contracts is allowed for the caller
(define-private (approve-revoke-contract-allowed)
  (or (is-owner)
      (and (is-agent)
           (not (is-eq u0 (bit-and (var-get agentPermissions) PERMISSION_APPROVE_REVOKE_CONTRACTS)))))
)

;; Check if buying/selling assets is allowed for the caller
(define-private (buy-sell-assets-allowed)
  (or (is-owner)
      (and (is-agent)
           (not (is-eq u0 (bit-and (var-get agentPermissions) PERMISSION_BUY_SELL_ASSETS)))))
)

;; ============================================================
;; DEPLOYMENT
;; ============================================================

(begin
  (print {
    notification: "agent-account/deployed",
    payload: {
      account: SELF,
      deployer: DEPLOYER,
      deployedBurnBlock: DEPLOYED_BURN_BLOCK,
      deployedStacksBlock: DEPLOYED_STACKS_BLOCK
    }
  })
)
