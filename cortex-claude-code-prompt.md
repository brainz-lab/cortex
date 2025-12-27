# Cortex - Feature Flags & Rollouts

## Overview

Cortex is a feature flag and rollout management system for Rails applications. Control who sees what, when.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                              CORTEX                                          │
│                    "Smart feature decisions"                                 │
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐   │
│   │                                                                      │   │
│   │   if Cortex.enabled?(:new_checkout, user: current_user)              │   │
│   │     render_new_checkout                                              │   │
│   │   else                                                               │   │
│   │     render_old_checkout                                              │   │
│   │   end                                                                │   │
│   │                                                                      │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│   │   Boolean   │  │  Percentage │  │   Segment   │  │   A/B Test  │        │
│   │    Flags    │  │   Rollout   │  │  Targeting  │  │  Experiment │        │
│   │             │  │             │  │             │  │             │        │
│   │  on / off   │  │  0-100%     │  │  rules      │  │  variants   │        │
│   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                                              │
│   Features: Kill switches • Gradual rollouts • User targeting •             │
│             A/B testing • Scheduled releases • Audit logs                   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **API** | Rails 8 API | Flag evaluation, management |
| **Database** | PostgreSQL | Store flags, rules, audit logs |
| **Cache** | Redis | Fast flag evaluation |
| **SDK** | Ruby gem | Client-side evaluation |
| **Real-time** | ActionCable | Flag change propagation |
| **Background** | Solid Queue | Scheduled flags, cleanup |

---

## Directory Structure

```
cortex/
├── README.md
├── LICENSE
├── Dockerfile
├── docker-compose.yml
├── .env.example
│
├── config/
│   ├── routes.rb
│   ├── database.yml
│   ├── redis.yml
│   └── initializers/
│       └── solid_queue.rb
│
├── app/
│   ├── controllers/
│   │   ├── api/v1/
│   │   │   ├── flags_controller.rb
│   │   │   ├── evaluations_controller.rb
│   │   │   ├── segments_controller.rb
│   │   │   ├── environments_controller.rb
│   │   │   └── audit_logs_controller.rb
│   │   └── internal/
│   │       └── sdk_controller.rb
│   │
│   ├── models/
│   │   ├── flag.rb
│   │   ├── flag_rule.rb
│   │   ├── flag_variant.rb
│   │   ├── segment.rb
│   │   ├── segment_rule.rb
│   │   ├── environment.rb
│   │   ├── flag_environment.rb
│   │   ├── evaluation_log.rb
│   │   └── audit_log.rb
│   │
│   ├── services/
│   │   ├── evaluator.rb
│   │   ├── targeting_engine.rb
│   │   ├── percentage_calculator.rb
│   │   ├── variant_assigner.rb
│   │   ├── cache_manager.rb
│   │   └── webhook_notifier.rb
│   │
│   ├── jobs/
│   │   ├── scheduled_flag_job.rb
│   │   ├── cache_invalidation_job.rb
│   │   └── cleanup_evaluation_logs_job.rb
│   │
│   └── channels/
│       └── flags_channel.rb
│
├── lib/
│   └── cortex/
│       └── mcp/
│           ├── server.rb
│           └── tools/
│               ├── list_flags.rb
│               ├── get_flag.rb
│               ├── toggle_flag.rb
│               ├── create_flag.rb
│               └── evaluate_flag.rb
│
└── spec/
    ├── models/
    ├── services/
    └── requests/
```

---

## Database Schema

```ruby
# db/migrate/001_create_environments.rb

class CreateEnvironments < ActiveRecord::Migration[8.0]
  def change
    create_table :environments, id: :uuid do |t|
      t.references :project, type: :uuid, null: false, foreign_key: { to_table: :platform_projects }
      
      t.string :name, null: false           # production, staging, development
      t.string :key, null: false            # env_prod_xxx
      t.string :color                       # #22c55e (for UI)
      t.boolean :production, default: false # Is this a production env?
      t.integer :position, default: 0
      
      t.timestamps
      
      t.index [:project_id, :name], unique: true
      t.index [:project_id, :key], unique: true
    end
  end
end

# db/migrate/002_create_flags.rb

class CreateFlags < ActiveRecord::Migration[8.0]
  def change
    create_table :flags, id: :uuid do |t|
      t.references :project, type: :uuid, null: false, foreign_key: { to_table: :platform_projects }
      
      t.string :key, null: false              # new_checkout, dark_mode
      t.string :name, null: false             # New Checkout Flow
      t.text :description
      
      # Flag type
      t.string :flag_type, null: false, default: 'boolean'
      # boolean: on/off
      # percentage: gradual rollout
      # variant: A/B test with multiple variants
      # segment: rule-based targeting
      
      # Tags for organization
      t.string :tags, array: true, default: []
      
      # Lifecycle
      t.boolean :archived, default: false
      t.boolean :permanent, default: false    # Can't be deleted (kill switches)
      
      # Ownership
      t.string :owner_email
      
      t.timestamps
      
      t.index [:project_id, :key], unique: true
      t.index :tags, using: :gin
    end
  end
end

# db/migrate/003_create_flag_environments.rb

class CreateFlagEnvironments < ActiveRecord::Migration[8.0]
  def change
    create_table :flag_environments, id: :uuid do |t|
      t.references :flag, type: :uuid, null: false, foreign_key: true
      t.references :environment, type: :uuid, null: false, foreign_key: true
      
      # State
      t.boolean :enabled, default: false
      
      # For percentage rollouts
      t.integer :percentage, default: 0       # 0-100
      
      # Default variant (for variant flags)
      t.references :default_variant, type: :uuid, foreign_key: { to_table: :flag_variants }
      
      # Scheduling
      t.datetime :enable_at                   # Scheduled enable
      t.datetime :disable_at                  # Scheduled disable
      
      # Metadata
      t.jsonb :metadata, default: {}
      
      t.timestamps
      
      t.index [:flag_id, :environment_id], unique: true
    end
  end
end

# db/migrate/004_create_flag_variants.rb

class CreateFlagVariants < ActiveRecord::Migration[8.0]
  def change
    create_table :flag_variants, id: :uuid do |t|
      t.references :flag, type: :uuid, null: false, foreign_key: true
      
      t.string :key, null: false              # control, treatment_a, treatment_b
      t.string :name, null: false             # Control, Treatment A
      t.text :description
      
      t.jsonb :payload, default: {}           # Custom data for variant
      # {
      #   button_color: "blue",
      #   cta_text: "Buy Now"
      # }
      
      t.integer :weight, default: 100         # For weighted distribution
      t.integer :position, default: 0
      
      t.timestamps
      
      t.index [:flag_id, :key], unique: true
    end
  end
end

# db/migrate/005_create_segments.rb

class CreateSegments < ActiveRecord::Migration[8.0]
  def change
    create_table :segments, id: :uuid do |t|
      t.references :project, type: :uuid, null: false, foreign_key: { to_table: :platform_projects }
      
      t.string :key, null: false              # beta_users, enterprise_customers
      t.string :name, null: false             # Beta Users
      t.text :description
      
      # Rule matching mode
      t.string :match_type, default: 'all'    # all, any
      
      t.timestamps
      
      t.index [:project_id, :key], unique: true
    end
  end
end

# db/migrate/006_create_segment_rules.rb

class CreateSegmentRules < ActiveRecord::Migration[8.0]
  def change
    create_table :segment_rules, id: :uuid do |t|
      t.references :segment, type: :uuid, null: false, foreign_key: true
      
      t.string :attribute, null: false        # email, plan, country, user_id
      t.string :operator, null: false         # eq, neq, contains, gt, lt, in, regex
      t.string :value, null: false            # pro, @company.com, US
      
      t.integer :position, default: 0
      
      t.timestamps
      
      t.index [:segment_id, :position]
    end
  end
end

# db/migrate/007_create_flag_rules.rb

class CreateFlagRules < ActiveRecord::Migration[8.0]
  def change
    create_table :flag_rules, id: :uuid do |t|
      t.references :flag_environment, type: :uuid, null: false, foreign_key: true
      
      # Rule type
      t.string :rule_type, null: false        # segment, attribute, user_id
      
      # For segment rules
      t.references :segment, type: :uuid, foreign_key: true
      
      # For attribute rules
      t.string :attribute
      t.string :operator
      t.string :value
      
      # For user_id rules (specific users)
      t.string :user_ids, array: true, default: []
      
      # What happens when rule matches
      t.boolean :serve_enabled, default: true  # For boolean flags
      t.references :serve_variant, type: :uuid, foreign_key: { to_table: :flag_variants }
      t.integer :serve_percentage              # For percentage override
      
      t.integer :position, default: 0          # Rule priority
      
      t.timestamps
      
      t.index [:flag_environment_id, :position]
    end
  end
end

# db/migrate/008_create_evaluation_logs.rb

class CreateEvaluationLogs < ActiveRecord::Migration[8.0]
  def change
    create_table :evaluation_logs, id: :uuid do |t|
      t.references :project, type: :uuid, null: false, foreign_key: { to_table: :platform_projects }
      t.references :flag, type: :uuid, null: false, foreign_key: true
      t.references :environment, type: :uuid, null: false, foreign_key: true
      
      # Context
      t.string :user_id
      t.jsonb :context, default: {}           # Full evaluation context
      
      # Result
      t.boolean :result                       # For boolean flags
      t.string :variant_key                   # For variant flags
      t.string :matched_rule_id               # Which rule matched
      t.string :evaluation_reason             # Why this result
      # target_match, rule_match, percentage_rollout, default, disabled
      
      t.datetime :evaluated_at, null: false
      
      t.timestamps
    end
    
    # Partition by month for performance
    # In production, use TimescaleDB hypertable
  end
end

# db/migrate/009_create_audit_logs.rb

class CreateAuditLogs < ActiveRecord::Migration[8.0]
  def change
    create_table :audit_logs, id: :uuid do |t|
      t.references :project, type: :uuid, null: false, foreign_key: { to_table: :platform_projects }
      t.references :flag, type: :uuid, foreign_key: true
      t.references :environment, type: :uuid, foreign_key: true
      
      # Actor
      t.references :user, type: :uuid, foreign_key: { to_table: :platform_users }
      t.string :actor_email
      t.string :actor_ip
      
      # Action
      t.string :action, null: false           # created, updated, enabled, disabled, archived
      t.string :resource_type, null: false    # Flag, Segment, FlagRule
      t.uuid :resource_id
      
      # Changes
      t.jsonb :changes, default: {}           # { field: [old, new] }
      t.jsonb :metadata, default: {}
      
      t.datetime :performed_at, null: false
      
      t.timestamps
      
      t.index [:project_id, :performed_at]
      t.index [:flag_id, :performed_at]
    end
  end
end
```

---

## Models

```ruby
# app/models/flag.rb

class Flag < ApplicationRecord
  belongs_to :project, class_name: 'Platform::Project'
  
  has_many :flag_environments, dependent: :destroy
  has_many :environments, through: :flag_environments
  has_many :variants, class_name: 'FlagVariant', dependent: :destroy
  has_many :evaluation_logs, dependent: :destroy
  has_many :audit_logs, dependent: :nullify
  
  validates :key, presence: true, 
            uniqueness: { scope: :project_id },
            format: { with: /\A[a-z][a-z0-9_]*\z/, message: 'must be lowercase with underscores' }
  validates :name, presence: true
  validates :flag_type, presence: true, inclusion: { in: %w[boolean percentage variant segment] }
  
  scope :active, -> { where(archived: false) }
  scope :archived, -> { where(archived: true) }
  scope :by_tag, ->(tag) { where('? = ANY(tags)', tag) }
  
  FLAG_TYPES = {
    'boolean' => 'On/Off Toggle',
    'percentage' => 'Percentage Rollout',
    'variant' => 'A/B Test Variants',
    'segment' => 'Segment Targeting'
  }.freeze
  
  after_create :create_environment_configs
  after_update :invalidate_cache
  
  def enabled_in?(environment)
    flag_env = flag_environments.find_by(environment: environment)
    flag_env&.enabled || false
  end
  
  def evaluate(environment:, context: {})
    Evaluator.new(self, environment, context).evaluate
  end
  
  def archive!
    update!(archived: true)
    flag_environments.update_all(enabled: false)
  end
  
  def restore!
    update!(archived: false)
  end
  
  private
  
  def create_environment_configs
    project.environments.find_each do |env|
      flag_environments.create!(environment: env, enabled: false)
    end
  end
  
  def invalidate_cache
    CacheManager.invalidate_flag(self)
  end
end

# app/models/flag_environment.rb

class FlagEnvironment < ApplicationRecord
  belongs_to :flag
  belongs_to :environment
  belongs_to :default_variant, class_name: 'FlagVariant', optional: true
  
  has_many :rules, class_name: 'FlagRule', dependent: :destroy
  
  validates :flag_id, uniqueness: { scope: :environment_id }
  validates :percentage, numericality: { 
    greater_than_or_equal_to: 0, 
    less_than_or_equal_to: 100 
  }, allow_nil: true
  
  after_update :invalidate_cache
  after_update :broadcast_change
  after_update :check_scheduled_changes
  
  scope :enabled, -> { where(enabled: true) }
  scope :with_scheduled, -> { where.not(enable_at: nil).or(where.not(disable_at: nil)) }
  
  def toggle!
    update!(enabled: !enabled)
  end
  
  def schedule_enable(at:)
    update!(enable_at: at)
    ScheduledFlagJob.set(wait_until: at).perform_later(id, :enable)
  end
  
  def schedule_disable(at:)
    update!(disable_at: at)
    ScheduledFlagJob.set(wait_until: at).perform_later(id, :disable)
  end
  
  private
  
  def invalidate_cache
    CacheManager.invalidate_flag_environment(self)
  end
  
  def broadcast_change
    FlagsChannel.broadcast_to(
      flag.project,
      { action: 'updated', flag_key: flag.key, environment: environment.key, enabled: enabled }
    )
  end
  
  def check_scheduled_changes
    # Clear scheduled times if manually toggled
    if saved_change_to_enabled?
      update_columns(enable_at: nil, disable_at: nil)
    end
  end
end

# app/models/flag_variant.rb

class FlagVariant < ApplicationRecord
  belongs_to :flag
  
  validates :key, presence: true, 
            uniqueness: { scope: :flag_id },
            format: { with: /\A[a-z][a-z0-9_]*\z/ }
  validates :name, presence: true
  validates :weight, numericality: { greater_than_or_equal_to: 0 }
  
  scope :ordered, -> { order(:position) }
  
  def percentage
    total_weight = flag.variants.sum(:weight)
    return 0 if total_weight.zero?
    (weight.to_f / total_weight * 100).round(1)
  end
end

# app/models/segment.rb

class Segment < ApplicationRecord
  belongs_to :project, class_name: 'Platform::Project'
  
  has_many :rules, class_name: 'SegmentRule', dependent: :destroy
  has_many :flag_rules, dependent: :nullify
  
  validates :key, presence: true, 
            uniqueness: { scope: :project_id },
            format: { with: /\A[a-z][a-z0-9_]*\z/ }
  validates :name, presence: true
  validates :match_type, inclusion: { in: %w[all any] }
  
  accepts_nested_attributes_for :rules, allow_destroy: true
  
  def matches?(context)
    return false if rules.empty?
    
    case match_type
    when 'all'
      rules.all? { |rule| rule.matches?(context) }
    when 'any'
      rules.any? { |rule| rule.matches?(context) }
    end
  end
end

# app/models/segment_rule.rb

class SegmentRule < ApplicationRecord
  belongs_to :segment
  
  validates :attribute, presence: true
  validates :operator, presence: true, inclusion: { 
    in: %w[eq neq contains not_contains starts_with ends_with gt gte lt lte in not_in regex]
  }
  validates :value, presence: true
  
  OPERATORS = {
    'eq' => 'equals',
    'neq' => 'not equals',
    'contains' => 'contains',
    'not_contains' => 'does not contain',
    'starts_with' => 'starts with',
    'ends_with' => 'ends with',
    'gt' => 'greater than',
    'gte' => 'greater than or equal',
    'lt' => 'less than',
    'lte' => 'less than or equal',
    'in' => 'is one of',
    'not_in' => 'is not one of',
    'regex' => 'matches regex'
  }.freeze
  
  def matches?(context)
    attr_value = context[attribute.to_sym] || context[attribute.to_s]
    return false if attr_value.nil?
    
    case operator
    when 'eq'
      attr_value.to_s == value
    when 'neq'
      attr_value.to_s != value
    when 'contains'
      attr_value.to_s.include?(value)
    when 'not_contains'
      !attr_value.to_s.include?(value)
    when 'starts_with'
      attr_value.to_s.start_with?(value)
    when 'ends_with'
      attr_value.to_s.end_with?(value)
    when 'gt'
      attr_value.to_f > value.to_f
    when 'gte'
      attr_value.to_f >= value.to_f
    when 'lt'
      attr_value.to_f < value.to_f
    when 'lte'
      attr_value.to_f <= value.to_f
    when 'in'
      values = value.split(',').map(&:strip)
      values.include?(attr_value.to_s)
    when 'not_in'
      values = value.split(',').map(&:strip)
      !values.include?(attr_value.to_s)
    when 'regex'
      Regexp.new(value).match?(attr_value.to_s)
    else
      false
    end
  rescue RegexpError
    false
  end
end

# app/models/flag_rule.rb

class FlagRule < ApplicationRecord
  belongs_to :flag_environment
  belongs_to :segment, optional: true
  belongs_to :serve_variant, class_name: 'FlagVariant', optional: true
  
  validates :rule_type, presence: true, inclusion: { in: %w[segment attribute user_id] }
  validates :segment, presence: true, if: -> { rule_type == 'segment' }
  validates :attribute, presence: true, if: -> { rule_type == 'attribute' }
  validates :user_ids, presence: true, if: -> { rule_type == 'user_id' }
  
  scope :ordered, -> { order(:position) }
  
  def matches?(context)
    case rule_type
    when 'segment'
      segment.matches?(context)
    when 'attribute'
      SegmentRule.new(attribute: attribute, operator: operator, value: value).matches?(context)
    when 'user_id'
      user_id = context[:user_id] || context['user_id'] || context.dig(:user, :id)
      user_ids.include?(user_id.to_s)
    else
      false
    end
  end
end
```

---

## Services

### Evaluator (Core Logic)

```ruby
# app/services/evaluator.rb

class Evaluator
  Result = Struct.new(:enabled, :variant, :reason, :rule_id, keyword_init: true)
  
  def initialize(flag, environment, context = {})
    @flag = flag
    @environment = environment.is_a?(String) ? find_environment(environment) : environment
    @context = normalize_context(context)
    @flag_env = flag.flag_environments.find_by(environment: @environment)
  end
  
  def evaluate
    return disabled_result('flag_not_found') unless @flag_env
    return disabled_result('flag_disabled') unless @flag_env.enabled
    
    # Check rules first (highest priority)
    if (rule_result = evaluate_rules)
      return rule_result
    end
    
    # Then evaluate based on flag type
    case @flag.flag_type
    when 'boolean'
      enabled_result('default')
    when 'percentage'
      evaluate_percentage
    when 'variant'
      evaluate_variant
    when 'segment'
      disabled_result('no_segment_match')
    end
  end
  
  private
  
  def evaluate_rules
    @flag_env.rules.ordered.each do |rule|
      next unless rule.matches?(@context)
      
      if @flag.flag_type == 'variant' && rule.serve_variant
        return Result.new(
          enabled: true,
          variant: rule.serve_variant.key,
          reason: 'rule_match',
          rule_id: rule.id
        )
      elsif rule.serve_percentage
        return evaluate_percentage_with(rule.serve_percentage, "rule_percentage_#{rule.id}")
      else
        return Result.new(
          enabled: rule.serve_enabled,
          variant: nil,
          reason: 'rule_match',
          rule_id: rule.id
        )
      end
    end
    
    nil
  end
  
  def evaluate_percentage
    evaluate_percentage_with(@flag_env.percentage, 'percentage_rollout')
  end
  
  def evaluate_percentage_with(percentage, reason)
    bucket = PercentageCalculator.bucket_for(@flag.key, user_identifier)
    enabled = bucket < percentage
    
    Result.new(enabled: enabled, variant: nil, reason: reason, rule_id: nil)
  end
  
  def evaluate_variant
    variant = VariantAssigner.assign(@flag, user_identifier, @flag_env.default_variant)
    
    Result.new(
      enabled: true,
      variant: variant&.key,
      reason: 'variant_assignment',
      rule_id: nil
    )
  end
  
  def user_identifier
    @context[:user_id] || @context[:id] || @context[:anonymous_id] || SecureRandom.uuid
  end
  
  def normalize_context(context)
    # Flatten user hash if present
    if context[:user].is_a?(Hash)
      context.merge(context[:user]).except(:user)
    else
      context
    end.with_indifferent_access
  end
  
  def find_environment(key)
    @flag.project.environments.find_by!(key: key)
  rescue ActiveRecord::RecordNotFound
    @flag.project.environments.find_by!(name: key)
  end
  
  def enabled_result(reason)
    Result.new(enabled: true, variant: nil, reason: reason, rule_id: nil)
  end
  
  def disabled_result(reason)
    Result.new(enabled: false, variant: nil, reason: reason, rule_id: nil)
  end
end
```

### Percentage Calculator

```ruby
# app/services/percentage_calculator.rb

class PercentageCalculator
  # Deterministic bucketing based on flag key + user ID
  # Same user always gets same bucket for same flag
  
  def self.bucket_for(flag_key, user_id)
    hash_input = "#{flag_key}:#{user_id}"
    hash_value = Digest::SHA256.hexdigest(hash_input)
    
    # Use first 8 hex chars (32 bits) for bucket
    bucket = hash_value[0, 8].to_i(16)
    
    # Normalize to 0-100
    (bucket.to_f / 0xFFFFFFFF * 100).floor
  end
  
  def self.in_rollout?(flag_key, user_id, percentage)
    bucket_for(flag_key, user_id) < percentage
  end
end
```

### Variant Assigner

```ruby
# app/services/variant_assigner.rb

class VariantAssigner
  def self.assign(flag, user_id, default_variant = nil)
    variants = flag.variants.ordered
    return default_variant if variants.empty?
    
    # Deterministic assignment based on user
    bucket = PercentageCalculator.bucket_for("#{flag.key}:variant", user_id)
    
    # Calculate cumulative weights
    total_weight = variants.sum(:weight)
    return variants.first if total_weight.zero?
    
    cumulative = 0
    variants.each do |variant|
      cumulative += (variant.weight.to_f / total_weight * 100)
      return variant if bucket < cumulative
    end
    
    variants.last
  end
end
```

### Cache Manager

```ruby
# app/services/cache_manager.rb

class CacheManager
  CACHE_TTL = 1.minute
  FLAG_PREFIX = 'cortex:flag'
  
  class << self
    def get_flag(project_id, flag_key, environment_key)
      cache_key = "#{FLAG_PREFIX}:#{project_id}:#{flag_key}:#{environment_key}"
      
      Rails.cache.fetch(cache_key, expires_in: CACHE_TTL) do
        load_flag_data(project_id, flag_key, environment_key)
      end
    end
    
    def invalidate_flag(flag)
      flag.flag_environments.each do |flag_env|
        invalidate_flag_environment(flag_env)
      end
    end
    
    def invalidate_flag_environment(flag_env)
      cache_key = "#{FLAG_PREFIX}:#{flag_env.flag.project_id}:#{flag_env.flag.key}:#{flag_env.environment.key}"
      Rails.cache.delete(cache_key)
      
      # Also invalidate project-wide cache
      Rails.cache.delete("#{FLAG_PREFIX}:#{flag_env.flag.project_id}:all:#{flag_env.environment.key}")
    end
    
    def get_all_flags(project_id, environment_key)
      cache_key = "#{FLAG_PREFIX}:#{project_id}:all:#{environment_key}"
      
      Rails.cache.fetch(cache_key, expires_in: CACHE_TTL) do
        load_all_flags(project_id, environment_key)
      end
    end
    
    private
    
    def load_flag_data(project_id, flag_key, environment_key)
      flag = Flag.joins(:project)
                 .where(platform_projects: { id: project_id }, key: flag_key)
                 .first
      
      return nil unless flag
      
      env = flag.project.environments.find_by(key: environment_key)
      return nil unless env
      
      flag_env = flag.flag_environments.includes(:rules, :default_variant).find_by(environment: env)
      
      {
        key: flag.key,
        type: flag.flag_type,
        enabled: flag_env&.enabled || false,
        percentage: flag_env&.percentage,
        variants: flag.variants.map { |v| { key: v.key, weight: v.weight, payload: v.payload } },
        rules: serialize_rules(flag_env&.rules || [])
      }
    end
    
    def load_all_flags(project_id, environment_key)
      # Load all active flags for a project/environment
      # Used for SDK bootstrap
    end
    
    def serialize_rules(rules)
      rules.map do |rule|
        {
          id: rule.id,
          type: rule.rule_type,
          segment_key: rule.segment&.key,
          attribute: rule.attribute,
          operator: rule.operator,
          value: rule.value,
          user_ids: rule.user_ids,
          serve_enabled: rule.serve_enabled,
          serve_variant: rule.serve_variant&.key,
          serve_percentage: rule.serve_percentage
        }
      end
    end
  end
end
```

### Targeting Engine

```ruby
# app/services/targeting_engine.rb

class TargetingEngine
  def initialize(project)
    @project = project
  end
  
  # Find all users who would be targeted by a flag
  def targeted_users(flag, environment)
    flag_env = flag.flag_environments.find_by(environment: environment)
    return [] unless flag_env
    
    user_ids = []
    
    flag_env.rules.each do |rule|
      case rule.rule_type
      when 'user_id'
        user_ids.concat(rule.user_ids)
      when 'segment'
        # Would need to query your user database
        # This is just for estimation
      end
    end
    
    user_ids.uniq
  end
  
  # Estimate rollout impact
  def estimate_rollout(flag, environment, percentage)
    # Based on historical traffic, estimate how many users
    # would be affected by a percentage rollout
    
    daily_users = EvaluationLog
      .where(flag: flag, environment: environment)
      .where('evaluated_at > ?', 24.hours.ago)
      .distinct
      .count(:user_id)
    
    (daily_users * percentage / 100.0).round
  end
end
```

---

## Controllers

```ruby
# app/controllers/api/v1/flags_controller.rb

module Api
  module V1
    class FlagsController < BaseController
      before_action :set_flag, only: [:show, :update, :destroy, :toggle]
      
      def index
        flags = current_project.flags.active
        flags = flags.by_tag(params[:tag]) if params[:tag]
        flags = flags.where(flag_type: params[:type]) if params[:type]
        
        render json: FlagSerializer.new(flags).serializable_hash
      end
      
      def show
        render json: FlagSerializer.new(@flag, include: [:variants, :environments]).serializable_hash
      end
      
      def create
        flag = current_project.flags.new(flag_params)
        
        if flag.save
          AuditLog.record!(current_user, flag, :created)
          render json: FlagSerializer.new(flag).serializable_hash, status: :created
        else
          render json: { errors: flag.errors }, status: :unprocessable_entity
        end
      end
      
      def update
        if @flag.update(flag_params)
          AuditLog.record!(current_user, @flag, :updated, changes: @flag.saved_changes)
          render json: FlagSerializer.new(@flag).serializable_hash
        else
          render json: { errors: @flag.errors }, status: :unprocessable_entity
        end
      end
      
      def destroy
        if @flag.permanent?
          render json: { error: 'Cannot delete permanent flag' }, status: :forbidden
        else
          @flag.archive!
          AuditLog.record!(current_user, @flag, :archived)
          head :no_content
        end
      end
      
      def toggle
        environment = current_project.environments.find(params[:environment_id])
        flag_env = @flag.flag_environments.find_by!(environment: environment)
        
        flag_env.toggle!
        
        AuditLog.record!(
          current_user, 
          @flag, 
          flag_env.enabled ? :enabled : :disabled,
          environment: environment
        )
        
        render json: { enabled: flag_env.enabled }
      end
      
      private
      
      def set_flag
        @flag = current_project.flags.find_by!(key: params[:id])
      end
      
      def flag_params
        params.require(:flag).permit(
          :key, :name, :description, :flag_type, :owner_email, :permanent,
          tags: [],
          variants_attributes: [:id, :key, :name, :description, :weight, :payload, :_destroy]
        )
      end
    end
  end
end

# app/controllers/api/v1/evaluations_controller.rb

module Api
  module V1
    class EvaluationsController < BaseController
      # Single flag evaluation
      def show
        flag = current_project.flags.find_by!(key: params[:flag_key])
        environment = params[:environment] || 'production'
        
        result = flag.evaluate(environment: environment, context: evaluation_context)
        
        log_evaluation(flag, environment, result) if should_log?
        
        render json: {
          key: flag.key,
          enabled: result.enabled,
          variant: result.variant,
          reason: result.reason
        }
      end
      
      # Bulk evaluation (all flags)
      def bulk
        environment = params[:environment] || 'production'
        flags = current_project.flags.active
        
        results = flags.map do |flag|
          result = flag.evaluate(environment: environment, context: evaluation_context)
          
          {
            key: flag.key,
            enabled: result.enabled,
            variant: result.variant
          }
        end
        
        render json: { flags: results }
      end
      
      private
      
      def evaluation_context
        params[:context]&.to_unsafe_h || {}
      end
      
      def should_log?
        params[:log] != 'false'
      end
      
      def log_evaluation(flag, environment, result)
        EvaluationLog.create!(
          project: current_project,
          flag: flag,
          environment: current_project.environments.find_by!(key: environment),
          user_id: evaluation_context[:user_id],
          context: evaluation_context,
          result: result.enabled,
          variant_key: result.variant,
          matched_rule_id: result.rule_id,
          evaluation_reason: result.reason,
          evaluated_at: Time.current
        )
      end
    end
  end
end

# app/controllers/api/v1/segments_controller.rb

module Api
  module V1
    class SegmentsController < BaseController
      before_action :set_segment, only: [:show, :update, :destroy]
      
      def index
        segments = current_project.segments
        render json: SegmentSerializer.new(segments).serializable_hash
      end
      
      def show
        render json: SegmentSerializer.new(@segment, include: [:rules]).serializable_hash
      end
      
      def create
        segment = current_project.segments.new(segment_params)
        
        if segment.save
          render json: SegmentSerializer.new(segment).serializable_hash, status: :created
        else
          render json: { errors: segment.errors }, status: :unprocessable_entity
        end
      end
      
      def update
        if @segment.update(segment_params)
          CacheManager.invalidate_segment(@segment)
          render json: SegmentSerializer.new(@segment).serializable_hash
        else
          render json: { errors: @segment.errors }, status: :unprocessable_entity
        end
      end
      
      def destroy
        if @segment.flag_rules.any?
          render json: { error: 'Segment is used by flag rules' }, status: :conflict
        else
          @segment.destroy!
          head :no_content
        end
      end
      
      private
      
      def set_segment
        @segment = current_project.segments.find_by!(key: params[:id])
      end
      
      def segment_params
        params.require(:segment).permit(
          :key, :name, :description, :match_type,
          rules_attributes: [:id, :attribute, :operator, :value, :position, :_destroy]
        )
      end
    end
  end
end

# app/controllers/internal/sdk_controller.rb

module Internal
  class SdkController < ApplicationController
    skip_before_action :verify_authenticity_token
    before_action :authenticate_sdk!
    
    # GET /internal/sdk/bootstrap
    # Returns all flags for SDK initialization
    def bootstrap
      environment = params[:environment] || 'production'
      
      flags = CacheManager.get_all_flags(current_project.id, environment)
      
      render json: {
        flags: flags,
        timestamp: Time.current.to_i
      }
    end
    
    # POST /internal/sdk/evaluate
    # Fast evaluation endpoint for SDK
    def evaluate
      flag_key = params[:flag]
      environment = params[:environment] || 'production'
      context = params[:context]&.to_unsafe_h || {}
      
      cached = CacheManager.get_flag(current_project.id, flag_key, environment)
      
      unless cached
        render json: { enabled: false, reason: 'flag_not_found' }
        return
      end
      
      # Fast evaluation from cached data
      result = evaluate_from_cache(cached, context)
      
      render json: result
    end
    
    private
    
    def authenticate_sdk!
      token = request.headers['X-SDK-Key'] || params[:sdk_key]
      
      @current_project = Platform::Project.find_by(sdk_key: token)
      
      unless @current_project
        render json: { error: 'Invalid SDK key' }, status: :unauthorized
      end
    end
    
    def current_project
      @current_project
    end
    
    def evaluate_from_cache(flag_data, context)
      # Simplified evaluation from cached data
      return { enabled: false, reason: 'disabled' } unless flag_data[:enabled]
      
      # Check rules
      flag_data[:rules].each do |rule|
        if rule_matches?(rule, context)
          return {
            enabled: rule[:serve_enabled],
            variant: rule[:serve_variant],
            reason: 'rule_match'
          }
        end
      end
      
      # Percentage rollout
      if flag_data[:percentage]
        user_id = context[:user_id] || context['user_id']
        in_rollout = PercentageCalculator.in_rollout?(flag_data[:key], user_id, flag_data[:percentage])
        return { enabled: in_rollout, reason: 'percentage' }
      end
      
      { enabled: true, reason: 'default' }
    end
    
    def rule_matches?(rule, context)
      case rule[:type]
      when 'user_id'
        user_id = context[:user_id] || context['user_id']
        rule[:user_ids]&.include?(user_id.to_s)
      when 'attribute'
        SegmentRule.new(
          attribute: rule[:attribute],
          operator: rule[:operator],
          value: rule[:value]
        ).matches?(context)
      else
        false
      end
    end
  end
end
```

---

## SDK Integration

### Ruby SDK Usage

```ruby
# In Rails app

# Gemfile
gem 'brainzlab'

# config/initializers/brainzlab.rb
BrainzLab.configure do |config|
  config.secret_key = ENV['BRAINZLAB_SECRET_KEY']
end

# Usage in controllers/services
class CheckoutController < ApplicationController
  def show
    if BrainzLab::Cortex.enabled?(:new_checkout, user: current_user)
      render :new_checkout
    else
      render :checkout
    end
  end
end

# With context
BrainzLab::Cortex.enabled?(:premium_feature, {
  user_id: current_user.id,
  email: current_user.email,
  plan: current_user.plan,
  country: current_user.country
})

# Get variant for A/B test
variant = BrainzLab::Cortex.variant(:checkout_button, user: current_user)
# => "control" or "treatment_a" or "treatment_b"

# Get variant payload
payload = BrainzLab::Cortex.payload(:checkout_button, user: current_user)
# => { button_color: "blue", cta_text: "Buy Now" }

# Bulk evaluation (more efficient)
flags = BrainzLab::Cortex.all(user: current_user)
# => { new_checkout: true, dark_mode: false, premium_feature: true }
```

### SDK Implementation

```ruby
# lib/brainzlab/cortex.rb

module BrainzLab
  module Cortex
    class << self
      def enabled?(flag_key, context = {})
        result = evaluate(flag_key, context)
        result[:enabled]
      end
      
      def disabled?(flag_key, context = {})
        !enabled?(flag_key, context)
      end
      
      def variant(flag_key, context = {})
        result = evaluate(flag_key, context)
        result[:variant]
      end
      
      def payload(flag_key, context = {})
        # Fetch full flag data including variant payloads
        flag_data = client.get_flag(flag_key)
        variant_key = variant(flag_key, context)
        
        return {} unless variant_key
        
        variant = flag_data[:variants]&.find { |v| v[:key] == variant_key }
        variant&.dig(:payload) || {}
      end
      
      def all(context = {})
        result = client.bulk_evaluate(context)
        result[:flags].each_with_object({}) do |flag, hash|
          hash[flag[:key].to_sym] = flag[:enabled]
        end
      end
      
      def evaluate(flag_key, context = {})
        normalized_context = normalize_context(context)
        
        # Try local cache first
        if cached = local_cache.get(flag_key, normalized_context)
          return cached
        end
        
        # Fetch from API
        result = client.evaluate(flag_key, normalized_context)
        local_cache.set(flag_key, normalized_context, result)
        
        result
      rescue => e
        BrainzLab.logger.error("Cortex evaluation error: #{e.message}")
        { enabled: false, variant: nil, reason: 'error' }
      end
      
      private
      
      def client
        @client ||= CortexClient.new
      end
      
      def local_cache
        @local_cache ||= LocalCache.new(ttl: 60.seconds)
      end
      
      def normalize_context(context)
        if context[:user].respond_to?(:id)
          user = context[:user]
          context.merge(
            user_id: user.id,
            email: user.try(:email),
            plan: user.try(:plan)
          ).except(:user)
        else
          context
        end
      end
    end
    
    class CortexClient
      def initialize
        @base_url = BrainzLab.configuration.cortex_url || 'https://cortex.brainzlab.ai'
        @sdk_key = BrainzLab.configuration.secret_key
      end
      
      def evaluate(flag_key, context)
        response = connection.get("/internal/sdk/evaluate") do |req|
          req.params[:flag] = flag_key
          req.params[:environment] = BrainzLab.configuration.environment
          req.params[:context] = context.to_json
        end
        
        JSON.parse(response.body, symbolize_names: true)
      end
      
      def bulk_evaluate(context)
        response = connection.post("/api/v1/evaluations/bulk") do |req|
          req.body = {
            environment: BrainzLab.configuration.environment,
            context: context
          }.to_json
        end
        
        JSON.parse(response.body, symbolize_names: true)
      end
      
      private
      
      def connection
        @connection ||= Faraday.new(@base_url) do |f|
          f.headers['X-SDK-Key'] = @sdk_key
          f.headers['Content-Type'] = 'application/json'
          f.adapter Faraday.default_adapter
        end
      end
    end
    
    class LocalCache
      def initialize(ttl:)
        @ttl = ttl
        @cache = {}
        @timestamps = {}
      end
      
      def get(key, context)
        cache_key = build_key(key, context)
        return nil unless @cache.key?(cache_key)
        return nil if expired?(cache_key)
        
        @cache[cache_key]
      end
      
      def set(key, context, value)
        cache_key = build_key(key, context)
        @cache[cache_key] = value
        @timestamps[cache_key] = Time.current
      end
      
      private
      
      def build_key(key, context)
        "#{key}:#{context[:user_id]}"
      end
      
      def expired?(cache_key)
        @timestamps[cache_key] < @ttl.ago
      end
    end
  end
end
```

---

## MCP Tools

```ruby
# lib/cortex/mcp/tools/list_flags.rb

module Cortex
  module Mcp
    module Tools
      class ListFlags < BaseTool
        TOOL_NAME = 'cortex_list_flags'
        DESCRIPTION = 'List all feature flags for a project'
        
        SCHEMA = {
          type: 'object',
          properties: {
            environment: {
              type: 'string',
              description: 'Environment (production, staging)',
              default: 'production'
            },
            tag: {
              type: 'string',
              description: 'Filter by tag'
            },
            include_archived: {
              type: 'boolean',
              description: 'Include archived flags',
              default: false
            }
          }
        }.freeze
        
        def call(args)
          flags = project.flags
          flags = flags.active unless args[:include_archived]
          flags = flags.by_tag(args[:tag]) if args[:tag]
          
          environment = project.environments.find_by(key: args[:environment] || 'production')
          
          {
            flags: flags.map do |flag|
              flag_env = flag.flag_environments.find_by(environment: environment)
              {
                key: flag.key,
                name: flag.name,
                type: flag.flag_type,
                enabled: flag_env&.enabled || false,
                tags: flag.tags,
                owner: flag.owner_email
              }
            end
          }
        end
      end
      
      class ToggleFlag < BaseTool
        TOOL_NAME = 'cortex_toggle_flag'
        DESCRIPTION = 'Enable or disable a feature flag'
        
        SCHEMA = {
          type: 'object',
          properties: {
            flag_key: {
              type: 'string',
              description: 'The flag key'
            },
            environment: {
              type: 'string',
              description: 'Environment (production, staging)',
              default: 'production'
            },
            enabled: {
              type: 'boolean',
              description: 'Enable or disable'
            }
          },
          required: ['flag_key', 'enabled']
        }.freeze
        
        def call(args)
          flag = project.flags.find_by!(key: args[:flag_key])
          environment = project.environments.find_by!(key: args[:environment] || 'production')
          flag_env = flag.flag_environments.find_by!(environment: environment)
          
          flag_env.update!(enabled: args[:enabled])
          
          {
            flag: flag.key,
            environment: environment.key,
            enabled: flag_env.enabled,
            message: "Flag #{flag.key} #{args[:enabled] ? 'enabled' : 'disabled'} in #{environment.name}"
          }
        end
      end
      
      class EvaluateFlag < BaseTool
        TOOL_NAME = 'cortex_evaluate'
        DESCRIPTION = 'Evaluate a flag for a specific user/context'
        
        SCHEMA = {
          type: 'object',
          properties: {
            flag_key: {
              type: 'string',
              description: 'The flag key'
            },
            user_id: {
              type: 'string',
              description: 'User ID to evaluate for'
            },
            context: {
              type: 'object',
              description: 'Additional context (email, plan, country, etc.)'
            },
            environment: {
              type: 'string',
              default: 'production'
            }
          },
          required: ['flag_key']
        }.freeze
        
        def call(args)
          flag = project.flags.find_by!(key: args[:flag_key])
          environment = project.environments.find_by!(key: args[:environment] || 'production')
          
          context = (args[:context] || {}).merge(user_id: args[:user_id])
          
          result = flag.evaluate(environment: environment, context: context)
          
          {
            flag: flag.key,
            enabled: result.enabled,
            variant: result.variant,
            reason: result.reason
          }
        end
      end
      
      class CreateFlag < BaseTool
        TOOL_NAME = 'cortex_create_flag'
        DESCRIPTION = 'Create a new feature flag'
        
        SCHEMA = {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Flag key (lowercase, underscores)'
            },
            name: {
              type: 'string',
              description: 'Human-readable name'
            },
            description: {
              type: 'string'
            },
            type: {
              type: 'string',
              enum: ['boolean', 'percentage', 'variant', 'segment'],
              default: 'boolean'
            },
            tags: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['key', 'name']
        }.freeze
        
        def call(args)
          flag = project.flags.create!(
            key: args[:key],
            name: args[:name],
            description: args[:description],
            flag_type: args[:type] || 'boolean',
            tags: args[:tags] || []
          )
          
          {
            created: true,
            flag: {
              key: flag.key,
              name: flag.name,
              type: flag.flag_type
            },
            message: "Flag #{flag.key} created. Enable it in environments to activate."
          }
        end
      end
    end
  end
end
```

---

## Routes

```ruby
# config/routes.rb

Rails.application.routes.draw do
  namespace :api do
    namespace :v1 do
      resources :flags, param: :key do
        member do
          post :toggle
        end
        
        resources :rules, controller: 'flag_rules'
        resources :variants, controller: 'flag_variants'
      end
      
      resources :segments, param: :key do
        resources :rules, controller: 'segment_rules'
      end
      
      resources :environments
      
      # Evaluations
      get 'evaluate/:flag_key', to: 'evaluations#show'
      post 'evaluate/bulk', to: 'evaluations#bulk'
      
      # Audit logs
      resources :audit_logs, only: [:index, :show]
    end
  end
  
  # Internal SDK endpoints
  namespace :internal do
    get 'sdk/bootstrap', to: 'sdk#bootstrap'
    post 'sdk/evaluate', to: 'sdk#evaluate'
  end
  
  # WebSocket for real-time updates
  mount ActionCable.server => '/cable'
  
  # Health
  get 'health', to: 'health#show'
end
```

---

## Real-time Updates

```ruby
# app/channels/flags_channel.rb

class FlagsChannel < ApplicationCable::Channel
  def subscribed
    stream_for current_project
  end
  
  def unsubscribed
    stop_all_streams
  end
end

# Broadcasting (called from FlagEnvironment model)
FlagsChannel.broadcast_to(
  project,
  {
    action: 'flag_updated',
    flag_key: 'new_checkout',
    environment: 'production',
    enabled: true,
    timestamp: Time.current.to_i
  }
)
```

---

## Docker Compose

```yaml
# docker-compose.yml

version: '3.8'

services:
  web:
    build: .
    ports:
      - "3006:3000"
    environment:
      - DATABASE_URL=postgres://postgres:postgres@db:5432/cortex
      - REDIS_URL=redis://redis:6379
      - PLATFORM_URL=http://platform:3000
    depends_on:
      - db
      - redis
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.cortex.rule=Host(`cortex.brainzlab.localhost`)"

  worker:
    build: .
    command: bundle exec rake solid_queue:start
    environment:
      - DATABASE_URL=postgres://postgres:postgres@db:5432/cortex
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=cortex
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

---

## Summary

### Cortex Features

| Feature | Description |
|---------|-------------|
| **Boolean Flags** | Simple on/off toggles |
| **Percentage Rollouts** | Gradual 0-100% rollout |
| **A/B Testing** | Multiple variants with weights |
| **Segment Targeting** | Rule-based user targeting |
| **Scheduling** | Enable/disable at specific times |
| **Audit Logs** | Full change history |
| **Real-time Updates** | WebSocket flag changes |
| **MCP Tools** | AI assistant integration |

### Flag Types

| Type | Use Case |
|------|----------|
| `boolean` | Kill switches, simple toggles |
| `percentage` | Gradual rollouts, canary releases |
| `variant` | A/B tests, multivariate experiments |
| `segment` | User targeting, beta programs |

### MCP Tools

| Tool | Description |
|------|-------------|
| `cortex_list_flags` | List all flags |
| `cortex_toggle_flag` | Enable/disable flag |
| `cortex_evaluate` | Check flag for user |
| `cortex_create_flag` | Create new flag |

---

*Cortex = Smart feature decisions! 🧠*
