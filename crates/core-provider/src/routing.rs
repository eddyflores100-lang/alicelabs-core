use std::collections::BTreeSet;

use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskComplexity {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoutingStrategy {
    Balanced,
    LowestCost,
    LowestLatency,
    HighestQuality,
}

#[derive(Debug, Clone)]
pub struct ModelCandidate {
    pub provider_id: String,
    pub model_id: String,
    pub capabilities: BTreeSet<String>,
    pub context_window_tokens: u64,
    pub input_cost_per_million: f64,
    pub output_cost_per_million: f64,
    pub estimated_latency_ms: u64,
    /// Relative quality estimate on a 0.0–1.0 scale.
    pub quality_score: f64,
    pub enabled: bool,
}

#[derive(Debug, Clone)]
pub struct TaskRequirements {
    pub required_capabilities: BTreeSet<String>,
    pub complexity: TaskComplexity,
    pub estimated_input_tokens: u64,
    pub max_output_tokens: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RouteDecision {
    pub provider_id: String,
    pub model_id: String,
    pub estimated_cost: f64,
    pub estimated_latency_ms: u64,
    pub score: f64,
    pub explanation: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RoutingError {
    #[error("no enabled model satisfies the task requirements")]
    NoEligibleModel,
}

pub fn select_model(
    candidates: &[ModelCandidate],
    task: &TaskRequirements,
    strategy: RoutingStrategy,
) -> Result<RouteDecision, RoutingError> {
    let eligible: Vec<&ModelCandidate> = candidates
        .iter()
        .filter(|candidate| candidate.enabled)
        .filter(|candidate| candidate.context_window_tokens >= task.estimated_input_tokens)
        .filter(|candidate| {
            task.required_capabilities
                .iter()
                .all(|capability| candidate.capabilities.contains(capability))
        })
        .filter(|candidate| {
            candidate.quality_score.is_finite()
                && (0.0..=1.0).contains(&candidate.quality_score)
                && candidate.input_cost_per_million.is_finite()
                && candidate.input_cost_per_million >= 0.0
                && candidate.output_cost_per_million.is_finite()
                && candidate.output_cost_per_million >= 0.0
        })
        .collect();

    if eligible.is_empty() {
        return Err(RoutingError::NoEligibleModel);
    }

    let costs: Vec<f64> = eligible
        .iter()
        .map(|candidate| {
            (task.estimated_input_tokens as f64 * candidate.input_cost_per_million
                + task.max_output_tokens as f64 * candidate.output_cost_per_million)
                / 1_000_000.0
        })
        .collect();
    let min_cost = costs.iter().copied().fold(f64::INFINITY, f64::min);
    let max_cost = costs.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let min_latency = eligible
        .iter()
        .map(|candidate| candidate.estimated_latency_ms)
        .min()
        .unwrap_or_default() as f64;
    let max_latency = eligible
        .iter()
        .map(|candidate| candidate.estimated_latency_ms)
        .max()
        .unwrap_or_default() as f64;

    eligible
        .into_iter()
        .map(|candidate| {
            let estimated_cost = (task.estimated_input_tokens as f64
                * candidate.input_cost_per_million
                + task.max_output_tokens as f64 * candidate.output_cost_per_million)
                / 1_000_000.0;
            let cost_score = normalize_lower_is_better(estimated_cost, min_cost, max_cost);
            let latency_score = normalize_lower_is_better(
                candidate.estimated_latency_ms as f64,
                min_latency,
                max_latency,
            );
            let (quality_weight, latency_weight, cost_weight) =
                weights(strategy, task.complexity);
            let score = candidate.quality_score * quality_weight
                + latency_score * latency_weight
                + cost_score * cost_weight;

            RouteDecision {
                provider_id: candidate.provider_id.clone(),
                model_id: candidate.model_id.clone(),
                estimated_cost,
                estimated_latency_ms: candidate.estimated_latency_ms,
                score,
                explanation: format!(
                    "Selected by {strategy:?}: quality {:.2}, estimated latency {} ms, estimated cost {:.6}",
                    candidate.quality_score,
                    candidate.estimated_latency_ms,
                    estimated_cost
                ),
            }
        })
        .max_by(|left, right| left.score.total_cmp(&right.score))
        .ok_or(RoutingError::NoEligibleModel)
}

fn normalize_lower_is_better(value: f64, minimum: f64, maximum: f64) -> f64 {
    if maximum <= minimum {
        1.0
    } else {
        1.0 - (value - minimum) / (maximum - minimum)
    }
}

fn weights(strategy: RoutingStrategy, complexity: TaskComplexity) -> (f64, f64, f64) {
    match strategy {
        RoutingStrategy::LowestCost => (0.10, 0.10, 0.80),
        RoutingStrategy::LowestLatency => (0.10, 0.80, 0.10),
        RoutingStrategy::HighestQuality => (0.80, 0.10, 0.10),
        RoutingStrategy::Balanced => match complexity {
            TaskComplexity::Low => (0.25, 0.25, 0.50),
            TaskComplexity::Medium => (0.50, 0.25, 0.25),
            TaskComplexity::High => (0.85, 0.10, 0.05),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(model_id: &str, cost: f64, quality: f64, latency: u64) -> ModelCandidate {
        ModelCandidate {
            provider_id: "test-provider".into(),
            model_id: model_id.into(),
            capabilities: ["text".to_string()].into_iter().collect(),
            context_window_tokens: 32_000,
            input_cost_per_million: cost,
            output_cost_per_million: cost,
            estimated_latency_ms: latency,
            quality_score: quality,
            enabled: true,
        }
    }

    fn task() -> TaskRequirements {
        TaskRequirements {
            required_capabilities: ["text".to_string()].into_iter().collect(),
            complexity: TaskComplexity::Medium,
            estimated_input_tokens: 2_000,
            max_output_tokens: 1_000,
        }
    }

    #[test]
    fn lowest_cost_strategy_selects_cheapest_eligible_model() {
        let candidates = vec![
            candidate("premium", 12.0, 0.98, 900),
            candidate("economy", 0.2, 0.75, 1_400),
        ];

        let route = select_model(&candidates, &task(), RoutingStrategy::LowestCost).unwrap();
        assert_eq!(route.model_id, "economy");
    }

    #[test]
    fn capability_requirements_exclude_incompatible_models() {
        let mut requirements = task();
        requirements.required_capabilities.insert("vision".into());

        let candidates = vec![candidate("text-only", 0.1, 0.9, 500)];
        assert_eq!(
            select_model(&candidates, &requirements, RoutingStrategy::Balanced),
            Err(RoutingError::NoEligibleModel)
        );
    }

    #[test]
    fn high_complexity_balanced_routing_prefers_quality() {
        let mut requirements = task();
        requirements.complexity = TaskComplexity::High;
        let candidates = vec![
            candidate("fast-economy", 0.1, 0.65, 200),
            candidate("reasoning", 2.0, 0.96, 900),
        ];

        let route = select_model(&candidates, &requirements, RoutingStrategy::Balanced).unwrap();
        assert_eq!(route.model_id, "reasoning");
    }
}
