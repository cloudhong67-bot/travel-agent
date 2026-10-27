/**
 * OpenTelemetry 계측 헬퍼. 내보내기(Application Insights)는 src/instrumentation.ts가 연결 문자열이 있을 때만 켠다.
 * 공급자가 등록되지 않으면 @opentelemetry/api가 no-op 트레이서를 돌려주므로 비용·부작용 없이 비활성화된다.
 */
import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";

export const tracer = trace.getTracer("trippilot");

/** fn을 span으로 감싼다. 예외는 span에 기록하고 다시 던진다 */
export async function withSpan<T>(name: string, attributes: Attributes, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message?.slice(0, 200) });
      throw error;
    } finally {
      span.end();
    }
  });
}
