import { register } from 'node:module';
import { metrics, propagation, trace, ROOT_CONTEXT, SpanKind } from '@opentelemetry/api';

// Imported first by app.js, which then loads the rest dynamically so http, express, redis and pino get patched.
// It starts only when OTEL_EXPORTER_OTLP_ENDPOINT is set; the OTEL_* variables configure it.
const enabled = !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SDK_DISABLED !== 'true';
export const otlpMetricsEnabled = enabled && process.env.OTEL_METRICS_EXPORTER !== 'none';

// Pushes the prom-client metrics, including those registered later, through OTel observable instruments.
const exportPrometheusMetrics = async () => {
  const { register, Counter, Gauge } = await import('prom-client');
  const meter = metrics.getMeter('bbb-webhooks');
  const observe = (metric, instrument, metricName) => instrument.addCallback(async (result) => {
    for (const { value, labels, metricName: valueName = metric.name } of (await metric.get()).values) {
      if (valueName === metricName) result.observe(value, labels);
    }
  });
  const bridge = (metric) => {
    const { name, help: description } = metric;
    if (metric instanceof Counter) {
      observe(metric, meter.createObservableCounter(name, { description }), name);
    } else if (metric instanceof Gauge) {
      observe(metric, meter.createObservableGauge(name, { description }), name);
    } else {
      for (const suffix of ['_sum', '_count']) {
        observe(metric, meter.createObservableCounter(name + suffix, { description }), name + suffix);
      }
    }
  };
  const registerMetric = register.registerMetric.bind(register);
  register.registerMetric = (metric) => {
    registerMetric(metric);
    bridge(metric);
  };
  register.getMetricsAsArray().forEach(bridge);
};

if (enabled) {
  process.env.OTEL_SERVICE_NAME ??= 'bbb-webhooks';
  process.env.OTEL_LOGS_EXPORTER ??= 'none';
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { HttpInstrumentation } = await import('@opentelemetry/instrumentation-http');
  const { ExpressInstrumentation } = await import('@opentelemetry/instrumentation-express');
  const { RedisInstrumentation } = await import('@opentelemetry/instrumentation-redis');
  const { PinoInstrumentation } = await import('@opentelemetry/instrumentation-pino');
  new NodeSDK({
    instrumentations: [
      new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => req.url?.startsWith('/metrics') }),
      new ExpressInstrumentation(),
      new RedisInstrumentation(),
      new PinoInstrumentation(),
    ],
  }).start();
  if (otlpMetricsEnabled) await exportPrometheusMetrics();
}

const USER_ID = /^[a-z]_[a-z0-9]+$/;
const tracer = trace.getTracer('bbb-webhooks');

// Starts the span of a received BBB message, continuing the sender's trace; the caller ends it.
export const startMessageSpan = (channel, message) => {
  const envelope = message?.envelope;
  if (!enabled || typeof envelope?.name !== 'string' || envelope.name.startsWith('CheckAliveP')) return null;
  const parent = envelope.routing && typeof envelope.routing === 'object'
    ? propagation.extract(ROOT_CONTEXT, envelope.routing)
    : ROOT_CONTEXT;
  const header = message.core?.header || {};
  return tracer.startSpan(`process ${envelope.name}`, {
    kind: SpanKind.CONSUMER,
    attributes: {
      'messaging.system': 'redis',
      'messaging.operation.type': 'process',
      'messaging.destination.name': channel,
      'bbb.message.name': envelope.name,
      'bbb.meeting.id': header.meetingId || undefined,
      'bbb.user.id': USER_ID.test(header.userId) ? header.userId : undefined,
    },
  }, parent);
};

