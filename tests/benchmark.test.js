/**
 * Automated Unit Tests for Benchmark Harness and Privacy Metrics
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md, 02_PRIVACY_FIREWALL_PLAN.md,
 * and 04_ANTIGRAVITY_CODING_EXECUTION_PLAN.md (Phase A17).
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateDetectionMetrics,
  calculateRedactionAccuracy,
  calculateByteReduction,
  runBenchmarks,
} from '../benchmarks/run.js';

const RESULTS_PATH = path.resolve('benchmarks/results.json');
const GROUND_TRUTH_PATH = path.resolve('demo-site/ground-truth.json');

// -------------------------------------------------------------
// Test Suite 1: Ground Truth Fixture Integrity
// -------------------------------------------------------------
test('Benchmark Fixtures: demo-site/ground-truth.json is valid and complete', () => {
  assert.ok(fs.existsSync(GROUND_TRUTH_PATH), 'ground-truth.json must exist');
  const raw = fs.readFileSync(GROUND_TRUTH_PATH, 'utf8');
  const data = JSON.parse(raw);

  assert.ok(data.workflows, 'Must define workflows');
  assert.ok(data.workflows.workflow_a, 'Must define workflow_a (Form Assistant)');
  assert.ok(data.workflows.workflow_b, 'Must define workflow_b (Statement Analysis)');

  // Verify Workflow A has planted synthetic entities
  const wfA = data.workflows.workflow_a;
  assert.strictEqual(wfA.entities.length >= 6, true, 'Workflow A must have at least 6 planted entities');
  const categoriesA = wfA.entities.map((e) => e.category);
  assert.ok(categoriesA.includes('name'));
  assert.ok(categoriesA.includes('email'));
  assert.ok(categoriesA.includes('phone'));
  assert.ok(categoriesA.includes('password'));
  assert.ok(categoriesA.includes('credit_card'));
  assert.ok(categoriesA.includes('address'));

  // Verify Workflow B has statement details
  const wfB = data.workflows.workflow_b;
  assert.ok(wfB.entities.some((e) => e.category === 'bank_account'));
  assert.strictEqual(wfB.groundTruthTotalSpending, 399.95);
  assert.strictEqual(wfB.transactions.length, 6);
});

// -------------------------------------------------------------
// Test Suite 2: Detection Metric Math (Precision, Recall, F1)
// -------------------------------------------------------------
test('Benchmark Math: Precision, Recall, and F1 calculations', () => {
  const groundTruth = [
    { id: '1', category: 'email', text: 'alice@test.com', tier: 1 },
    { id: '2', category: 'phone', text: '555-0199', tier: 1 },
    { id: '3', category: 'password', text: 'SecretPass!', tier: 3 },
  ];

  // Case 1: Perfect detection (3 TP, 0 FP, 0 FN)
  const perfectDetections = [
    { category: 'email', text: 'alice@test.com', tier: 1, confidence: 0.99 },
    { category: 'phone', text: '555-0199', tier: 1, confidence: 0.98 },
    { category: 'password', text: 'SecretPass!', tier: 3, confidence: 1.0 },
  ];
  const perfectMetrics = calculateDetectionMetrics(groundTruth, perfectDetections);
  assert.strictEqual(perfectMetrics.truePositives, 3);
  assert.strictEqual(perfectMetrics.falsePositives, 0);
  assert.strictEqual(perfectMetrics.falseNegatives, 0);
  assert.strictEqual(perfectMetrics.precision, 1.0);
  assert.strictEqual(perfectMetrics.recall, 1.0);
  assert.strictEqual(perfectMetrics.f1Score, 1.0);

  // Case 2: Partial detection with 1 False Positive (2 TP, 1 FP, 1 FN)
  const partialDetections = [
    { category: 'email', text: 'alice@test.com', tier: 1, confidence: 0.99 }, // TP
    { category: 'phone', text: '555-0199', tier: 1, confidence: 0.98 },      // TP
    { category: 'credit_card', text: '1234-5678-9012-3456', tier: 2, confidence: 0.8 }, // FP (not in GT)
    // Missing password (FN)
  ];
  const partialMetrics = calculateDetectionMetrics(groundTruth, partialDetections);
  assert.strictEqual(partialMetrics.truePositives, 2);
  assert.strictEqual(partialMetrics.falsePositives, 1);
  assert.strictEqual(partialMetrics.falseNegatives, 1);
  // Precision = 2 / 3 = 0.6667
  assert.strictEqual(partialMetrics.precision, 0.6667);
  // Recall = 2 / 3 = 0.6667
  assert.strictEqual(partialMetrics.recall, 0.6667);
  // F1 = 0.6667
  assert.strictEqual(partialMetrics.f1Score, 0.6667);

  // Case 3: Empty detections
  const emptyMetrics = calculateDetectionMetrics(groundTruth, []);
  assert.strictEqual(emptyMetrics.truePositives, 0);
  assert.strictEqual(emptyMetrics.recall, 0);
  assert.strictEqual(emptyMetrics.f1Score, 0);
});

// -------------------------------------------------------------
// Test Suite 3: Redaction Accuracy & Zero-Leak Auditing
// -------------------------------------------------------------
test('Benchmark Math: Redaction accuracy and leak detection audit', () => {
  const secrets = ['SuperSecretPassword123!', '4532 8912 3456 7890', '842'];

  // Case A: 100% clean redaction
  const cleanPayload = JSON.stringify({
    form: {
      password: '[REDACTED_SECRET]',
      card: '[TOKEN_CARD_1]',
      cvv: '[REDACTED_SECRET]',
    },
  });

  const cleanResult = calculateRedactionAccuracy(secrets, cleanPayload);
  assert.strictEqual(cleanResult.totalSecrets, 3);
  assert.strictEqual(cleanResult.leakedSecrets, 0);
  assert.strictEqual(cleanResult.redactionAccuracy, 100);
  assert.strictEqual(cleanResult.zeroLeakEnforced, true);
  assert.deepStrictEqual(cleanResult.leakedValues, []);

  // Case B: Secret leak detected
  const leakedPayload = JSON.stringify({
    form: {
      password: 'SuperSecretPassword123!', // LEAK!
      card: '[TOKEN_CARD_1]',
    },
  });

  const leakResult = calculateRedactionAccuracy(secrets, leakedPayload);
  assert.strictEqual(leakResult.leakedSecrets, 1);
  assert.strictEqual(leakResult.zeroLeakEnforced, false);
  assert.ok(leakResult.leakedValues.includes('SuperSecretPassword123!'));
  // 2 out of 3 protected = 66.67%
  assert.strictEqual(leakResult.redactionAccuracy, 66.67);
});

// -------------------------------------------------------------
// Test Suite 4: Byte Reduction Calculation
// -------------------------------------------------------------
test('Benchmark Math: Byte reduction and payload minimization', () => {
  const rawHtml = '<!DOCTYPE html><html><body>' + 'x'.repeat(10000) + '</body></html>';
  const sanitizedContext = {
    task: 'Submit form',
    elements: [{ id: 'submit', role: 'button' }],
  };

  const reduction = calculateByteReduction(rawHtml, sanitizedContext);
  assert.ok(reduction.rawBytes > 10000);
  assert.ok(reduction.sanitizedBytes < 200);
  assert.ok(reduction.reductionPercentage > 95, 'Must achieve > 95% reduction over raw DOM');
  assert.ok(reduction.compressionRatio > 10, 'Must have > 10x compression factor');
});

// -------------------------------------------------------------
// Test Suite 5: End-to-End Benchmark Execution
// -------------------------------------------------------------
test('Benchmark Runner: Executes full benchmark and exports machine-readable results', async () => {
  const report = await runBenchmarks({ silent: true });

  assert.ok(report, 'Benchmark report must be returned');
  assert.strictEqual(report.summary.totalWorkflows, 2);
  assert.strictEqual(report.summary.zeroLeakCompliance, true, 'Zero-leak compliance must be verified');
  assert.strictEqual(report.summary.averageRedactionAccuracy, 100, 'Redaction accuracy must be 100%');
  assert.ok(report.summary.averagePayloadReductionPct > 80, 'Payload reduction must exceed 80%');
  assert.ok(report.summary.overallPrecision > 0.8, 'PII detection precision must be high');
  assert.strictEqual(report.summary.overallRecall, 1.0, 'PII detection recall should be 100% on synthetic fixtures');

  // Verify file was written
  assert.ok(fs.existsSync(RESULTS_PATH), 'benchmarks/results.json must exist on disk');
  const written = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
  assert.strictEqual(written.summary.zeroLeakCompliance, true);
  assert.ok(written.workflows.workflow_a);
  assert.ok(written.workflows.workflow_b);

  // Invariant verification: no screenshots sent
  assert.strictEqual(written.workflows.workflow_a.invariants.rawScreenshotSent, false);
  assert.strictEqual(written.workflows.workflow_b.invariants.rawScreenshotSent, false);
  assert.strictEqual(written.workflows.workflow_a.invariants.rawSecretsSent, false);
  assert.strictEqual(written.workflows.workflow_b.invariants.rawSecretsSent, false);
});
