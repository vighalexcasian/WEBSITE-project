'use client';

import { useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase';

export type AiRiskHolding = {
  ticker: string;
  company: string;
  quantity: number;
  side: 'LONG' | 'SHORT';
  averageCost: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPL: number;
  currency: string;
};

type RiskMetricValue = string | number | null;

type AiRiskReportData = {
  sharpeRatio: RiskMetricValue;
  valueAtRisk: RiskMetricValue;
  beta: RiskMetricValue;
  summary: string;
  model: string;
};

type ReportState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; report: AiRiskReportData };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const metricValue = (value: unknown): RiskMetricValue => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
};

const firstValue = (record: Record<string, unknown>, keys: string[]) =>
  keys.map((key) => record[key]).find((value) => value !== undefined && value !== null);

const parseReport = (value: unknown): AiRiskReportData | null => {
  if (!isRecord(value)) return null;
  const data = isRecord(value.data) ? value.data : value;
  const metrics = isRecord(data.metrics)
    ? data.metrics
    : isRecord(data.risk_metrics)
      ? data.risk_metrics
      : isRecord(data.riskMetrics)
        ? data.riskMetrics
        : data;
  const summary = firstValue(data, ['executive_summary', 'executiveSummary', 'summary', 'report', 'analysis']);
  const sharpeRatio = metricValue(firstValue(metrics, ['sharpe_ratio', 'sharpeRatio', 'sharpe']));
  const valueAtRisk = metricValue(firstValue(metrics, ['value_at_risk', 'valueAtRisk', 'var', 'VaR']));
  const beta = metricValue(firstValue(metrics, ['beta', 'portfolio_beta', 'portfolioBeta']));

  if (
    typeof summary !== 'string' &&
    sharpeRatio === null &&
    valueAtRisk === null &&
    beta === null
  ) return null;

  return {
    sharpeRatio,
    valueAtRisk,
    beta,
    summary: typeof summary === 'string' ? summary : '',
    model: typeof data.model === 'string' && data.model.trim()
      ? data.model
      : 'Gemini 2.5 Flash',
  };
};

const renderInlineMarkdown = (text: string) =>
  text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return part;
  });

function MarkdownSummary({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const content = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const Heading = `h${heading[1].length + 2}` as 'h3' | 'h4' | 'h5' | 'h6';
      content.push(<Heading key={index}>{renderInlineMarkdown(heading[2])}</Heading>);
      index += 1;
      continue;
    }

    const listMatch = /^\s*([-*]|\d+\.)\s+(.+)$/.exec(lines[index]);
    if (listMatch) {
      const ordered = /^\d+\.$/.test(listMatch[1]);
      const items = [];
      while (index < lines.length) {
        const item = /^\s*([-*]|\d+\.)\s+(.+)$/.exec(lines[index]);
        if (!item || /^\d+\.$/.test(item[1]) !== ordered) break;
        items.push(<li key={index}>{renderInlineMarkdown(item[2])}</li>);
        index += 1;
      }
      content.push(ordered ? <ol key={`list-${index}`}>{items}</ol> : <ul key={`list-${index}`}>{items}</ul>);
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,4})\s+/.test(lines[index].trim()) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    content.push(<p key={`paragraph-${index}`}>{renderInlineMarkdown(paragraph.join(' '))}</p>);
  }

  return <div className="ai-risk-markdown">{content}</div>;
}

function LoadingSkeleton() {
  return (
    <div className="ai-risk-skeleton" aria-label="Generating risk analysis">
      <div className="ai-risk-skeleton-metrics">
        <span /><span /><span />
      </div>
      <span className="ai-risk-skeleton-line" />
      <span className="ai-risk-skeleton-line" />
      <span className="ai-risk-skeleton-line short" />
      <span className="ai-risk-skeleton-heading" />
      <span className="ai-risk-skeleton-line" />
      <span className="ai-risk-skeleton-line" />
    </div>
  );
}

export function AiRiskReport({ holdings }: { holdings: AiRiskHolding[] }) {
  const [state, setState] = useState<ReportState>({ status: 'idle' });

  const generateReport = async () => {
    setState({ status: 'loading' });
    try {
      const { data: { session }, error: sessionError } = await getSupabaseClient().auth.getSession();
      if (sessionError) throw new Error(`Could not verify your session: ${sessionError.message}`);
      if (!session?.access_token) throw new Error('Your session has expired. Please sign in again.');

      const response = await fetch('/api/risk-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ holdings }),
        cache: 'no-store',
      });
      const payload: unknown = await response.json();

      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : `Risk analysis request failed (${response.status}).`;
        throw new Error(message);
      }

      const report = parseReport(payload);
      if (!report) throw new Error('The risk analysis service returned an unsupported report format.');
      setState({ status: 'success', report });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to generate a risk report.',
      });
    }
  };

  const report = state.status === 'success' ? state.report : null;
  const metrics = report ? [
    { label: 'Sharpe Ratio', value: report.sharpeRatio },
    { label: 'Value at Risk', value: report.valueAtRisk },
    { label: 'Beta', value: report.beta },
  ] : [];

  return (
    <section className="panel ai-risk-report" aria-labelledby="ai-risk-report-title">
      <div className="ai-risk-report-heading">
        <div>
          <span className="risk-kicker">PORTFOLIO INTELLIGENCE</span>
          <h2 className="panel-title" id="ai-risk-report-title">AI Risk Insights &amp; Analysis</h2>
          <p className="panel-subtitle">A data-informed summary of your current portfolio exposure.</p>
        </div>
        <div className="ai-risk-report-actions">
          <span className="ai-risk-engine">✦ Powered by {report?.model ?? 'Gemini 2.5 Flash'}</span>
          <button
            className="button-secondary"
            type="button"
            onClick={() => void generateReport()}
            disabled={state.status === 'loading'}
          >
            {state.status === 'loading' ? 'Analyzing…' : report ? 'Regenerate report' : 'Generate risk report'}
          </button>
        </div>
      </div>
      {state.status === 'idle' && (
        <p className="ai-risk-report-prompt">
          {holdings.length > 0
            ? 'Generate an executive report with risk metrics and a structured portfolio summary.'
            : 'Generate an account status summary. Risk metrics will be unavailable until you have active positions.'}
        </p>
      )}
      {state.status === 'loading' && <LoadingSkeleton />}
      {state.status === 'error' && <p className="ai-risk-error" role="alert">{state.message}</p>}
      {report && (
        <div className="ai-risk-report-content">
          <div className="ai-risk-metrics" aria-label="Key risk metrics">
            {metrics.map((metric) => (
              <div className="ai-risk-metric" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value === null ? '—' : metric.value}</strong>
              </div>
            ))}
          </div>
          {report.summary
            ? <MarkdownSummary markdown={report.summary} />
            : <p className="ai-risk-report-prompt">The service returned metrics without an executive summary.</p>}
        </div>
      )}
    </section>
  );
}
