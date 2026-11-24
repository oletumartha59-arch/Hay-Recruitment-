import React, { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { Download, Info, FileSpreadsheet, Image as ImageIcon } from 'lucide-react';
import { registerHayEChartsTheme } from '../theme/echartsTheme';
import { downloadCsvRows, formatReportFilename } from '../lib/reports/exports';

registerHayEChartsTheme();

export interface ChartCardProps {
  title: string;
  subtitle: string;
  formulaInfo?: string;
  option: echarts.EChartsOption | null;
  loading?: boolean;
  emptyMessage?: string;
  height?: number;
  summaryText: string;
  csvHeaders?: string[];
  csvRows?: Array<Array<unknown>>;
  exportSlug?: string;
  onElementClick?: (params: { name: string; seriesName?: string; data?: unknown }) => void;
  chartRefCallback?: (getDataUrl: () => string | null) => void;
}

export const ChartCard: React.FC<ChartCardProps> = ({
  title,
  subtitle,
  formulaInfo,
  option,
  loading = false,
  emptyMessage = 'No employees match these filters',
  height = 280,
  summaryText,
  csvHeaders,
  csvRows,
  exportSlug = 'chart',
  onElementClick,
  chartRefCallback,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Lazy mount when scrolling into view
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setIsVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: '120px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isVisible || !option || loading) return;

    if (!instanceRef.current) {
      instanceRef.current = echarts.init(el, 'hay-workforce');
    }
    const chart = instanceRef.current;
    chart.setOption(option, { notMerge: true });

    const clickHandler = (params: echarts.ECElementEvent) => {
      if (onElementClick) {
        onElementClick({
          name: String(params.name ?? ''),
          seriesName: params.seriesName,
          data: params.data,
        });
      }
    };
    chart.off('click');
    if (onElementClick) {
      chart.on('click', clickHandler);
    }

    if (chartRefCallback) {
      chartRefCallback(() =>
        instanceRef.current
          ? instanceRef.current.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#FBF6EC' })
          : null
      );
    }

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
    };
  }, [option, isVisible, loading, onElementClick, chartRefCallback]);

  useEffect(() => {
    return () => {
      if (instanceRef.current) {
        instanceRef.current.dispose();
        instanceRef.current = null;
      }
    };
  }, []);

  const handleDownloadPng = () => {
    setMenuOpen(false);
    if (!instanceRef.current) return;
    const url = instanceRef.current.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: '#FBF6EC',
    });
    const a = document.createElement('a');
    a.href = url;
    a.download = formatReportFilename(exportSlug, 'png');
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleDownloadCsv = () => {
    setMenuOpen(false);
    if (!csvHeaders || !csvRows) return;
    downloadCsvRows(csvHeaders, csvRows, formatReportFilename(exportSlug, 'csv'));
  };

  return (
    <section
      className="card-surface p-4 flex flex-col gap-3 relative"
      aria-label={title}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-[var(--brown)] leading-snug">
            {title}
          </h3>
          <p className="text-xs text-[var(--muted)] mt-0.5 truncate" title={subtitle}>
            {subtitle}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 no-print relative">
          {formulaInfo && (
            <button
              type="button"
              onClick={() => setInfoOpen((v) => !v)}
              aria-label={`Formula and data details for ${title}`}
              className="w-7 h-7 rounded-md border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--cream)] inline-flex items-center justify-center text-[var(--muted)] hover:text-[var(--brown)] transition-colors"
            >
              <Info className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`Export options for ${title}`}
            className="h-7 px-2 rounded-md border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--cream)] inline-flex items-center gap-1 text-xs font-medium text-[var(--brown)] transition-colors"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Export</span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-8 z-30 w-40 card-surface p-1 shadow-sm">
              <button
                type="button"
                onClick={handleDownloadPng}
                className="w-full text-left px-2.5 py-1.5 text-xs rounded-md hover:bg-[var(--cream)] flex items-center gap-2 text-[var(--brown)]"
              >
                <ImageIcon className="w-3.5 h-3.5" aria-hidden="true" />
                Download PNG
              </button>
              {csvHeaders && csvRows && (
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  className="w-full text-left px-2.5 py-1.5 text-xs rounded-md hover:bg-[var(--cream)] flex items-center gap-2 text-[var(--brown)]"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
                  Download CSV
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {infoOpen && formulaInfo && (
        <div className="text-xs bg-[var(--cream)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--brown)]">
          {formulaInfo}
        </div>
      )}

      {loading ? (
        <div
          style={{ height }}
          className="w-full rounded-lg bg-[var(--cream)]/60 animate-pulse"
          aria-busy="true"
        />
      ) : !option ? (
        <div
          style={{ height }}
          className="w-full rounded-lg border border-dashed border-[var(--border)] flex items-center justify-center text-sm text-[var(--muted)]"
        >
          {emptyMessage}
        </div>
      ) : (
        <div ref={containerRef} style={{ height }} className="w-full" />
      )}

      {/* Screen reader summary */}
      <p className="sr-only">{summaryText}</p>
    </section>
  );
};
