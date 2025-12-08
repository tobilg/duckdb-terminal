import type uPlot from 'uplot';
import type {
  ChartType,
  ChartTheme,
  UPlotData,
  UPlotConstructor,
  AxisSelection,
} from './types';

/**
 * Options for rendering a chart
 */
export interface RenderOptions {
  /** Chart type */
  type: ChartType;
  /** Chart theme */
  theme: ChartTheme;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Series names for legend */
  seriesNames: string[];
  /** Axis configuration */
  axes: AxisSelection;
  /** X axis labels (for categorical) */
  xLabels?: string[];
  /** Whether X axis contains temporal (date/time) data */
  isXTemporal?: boolean;
}

/**
 * Wrapper class for uPlot chart rendering.
 * Handles chart creation, updates, resizing, and destruction.
 * Provides custom tooltip, legend, and axis formatting.
 */
export class ChartRenderer {
  private uPlot: UPlotConstructor;
  private chart: uPlot | null = null;
  private container: HTMLElement;

  /**
   * Creates a new ChartRenderer instance.
   * @param uPlotConstructor - The uPlot constructor function (loaded from CDN)
   * @param container - The HTML element to render the chart into
   */
  constructor(uPlotConstructor: UPlotConstructor, container: HTMLElement) {
    this.uPlot = uPlotConstructor;
    this.container = container;
  }

  /**
   * Render a chart with the given data and options.
   * Destroys any existing chart before creating a new one.
   * @param data - The chart data in uPlot columnar format (first array is X, rest are Y series)
   * @param options - Rendering options including type, theme, dimensions, and series names
   * @returns The created uPlot instance
   */
  render(data: UPlotData, options: RenderOptions): uPlot {
    // Destroy existing chart
    this.destroy();

    // Build uPlot options
    const uplotOptions = this.buildOptions(options);

    // Create chart
    this.chart = new this.uPlot(uplotOptions, data, this.container);

    // Create inline legend if there are multiple series
    if (options.seriesNames.length > 0) {
      this.createInlineLegend(options.seriesNames, options.theme);
    }

    return this.chart;
  }

  /**
   * Update chart with new data while keeping the same options.
   * @param data - The new chart data in uPlot columnar format
   */
  update(data: UPlotData): void {
    if (this.chart) {
      this.chart.setData(data);
    }
  }

  /**
   * Resize chart to new dimensions.
   * @param width - New width in pixels
   * @param height - New height in pixels
   */
  resize(width: number, height: number): void {
    if (this.chart) {
      this.chart.setSize({ width, height });
    }
  }

  /**
   * Get the underlying uPlot instance.
   * @returns The uPlot instance, or null if no chart is rendered
   */
  getChart(): uPlot | null {
    return this.chart;
  }

  /**
   * Get the chart canvas element for export operations.
   * @returns The canvas element, or null if no chart is rendered
   */
  getCanvas(): HTMLCanvasElement | null {
    return this.chart?.ctx?.canvas ?? null;
  }

  /**
   * Destroy the chart and clean up resources.
   * Removes the legend and destroys the uPlot instance.
   */
  destroy(): void {
    // Remove legend
    const legend = this.container.querySelector('.uplot-legend-below');
    if (legend) {
      legend.remove();
    }

    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  /**
   * Build uPlot options from render options.
   * Configures scales, axes, series, cursor, and plugins.
   * @param options - The render options
   * @returns uPlot configuration options
   */
  private buildOptions(options: RenderOptions): uPlot.Options {
    const { type, theme, width, height, seriesNames, axes, xLabels, isXTemporal } = options;

    // Base options
    const uplotOptions: uPlot.Options = {
      width,
      height,
      ...this.getChartPadding(),
      cursor: this.getCursorOptions(theme),
      legend: this.getLegendOptions(theme),
      scales: this.getScalesOptions(type, xLabels, isXTemporal),
      axes: this.getAxesOptions(theme, xLabels, isXTemporal),
      series: this.getSeriesOptions(type, theme, seriesNames, axes),
      plugins: [this.tooltipPlugin(theme, seriesNames, xLabels, isXTemporal)],
    };

    return uplotOptions;
  }

  /**
   * Create tooltip plugin for hover values.
   * Shows a tooltip with formatted X and Y values when hovering over data points.
   * @param theme - Chart theme for styling
   * @param seriesNames - Names of the data series for the tooltip
   * @param xLabels - Optional category labels for categorical X axis
   * @param isXTemporal - Whether X axis contains temporal data
   * @returns uPlot plugin configuration
   */
  private tooltipPlugin(
    theme: ChartTheme,
    seriesNames: string[],
    xLabels?: string[],
    isXTemporal?: boolean
  ): uPlot.Plugin {
    let tooltip: HTMLDivElement | null = null;
    let over: HTMLElement;

    const showTooltip = () => {
      if (tooltip) tooltip.style.display = 'block';
    };

    const hideTooltip = () => {
      if (tooltip) tooltip.style.display = 'none';
    };

    const formatValue = (value: number | null | undefined): string => {
      if (value == null) return '—';
      const absValue = Math.abs(value);
      if (absValue >= 1e9) return (value / 1e9).toFixed(2) + 'B';
      if (absValue >= 1e6) return (value / 1e6).toFixed(2) + 'M';
      if (absValue >= 1e3) return (value / 1e3).toFixed(2) + 'K';
      if (absValue < 1 && absValue > 0) return value.toPrecision(3);
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    };

    const formatXValue = (
      u: uPlot,
      idx: number,
      _xLabels?: string[],
      _isXTemporal?: boolean
    ): string => {
      const xVal = u.data[0][idx];
      if (xVal == null) return '—';

      // Categorical X axis
      if (_xLabels && _xLabels.length > 0) {
        const labelIdx = Math.round(xVal);
        return _xLabels[labelIdx] ?? String(xVal);
      }

      // Temporal X axis - format as date
      if (_isXTemporal) {
        // xVal is in seconds, convert to date
        const date = new Date(xVal * 1000);
        return date.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      }

      // Numeric
      return formatValue(xVal);
    };

    return {
      hooks: {
        init: (u: uPlot) => {
          over = u.over;

          // Create tooltip element
          tooltip = document.createElement('div');
          tooltip.className = 'uplot-tooltip';
          tooltip.style.cssText = `
            position: absolute;
            display: none;
            background: ${theme.tooltipBg};
            color: ${theme.tooltipFg};
            padding: 8px 12px;
            border-radius: 4px;
            font-family: system-ui, sans-serif;
            font-size: 12px;
            pointer-events: none;
            z-index: 100;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            white-space: nowrap;
          `;

          // Append to the over element (chart area)
          over.appendChild(tooltip);

          // Hide on mouse leave
          over.addEventListener('mouseleave', hideTooltip);
          over.addEventListener('mouseenter', showTooltip);
        },

        setCursor: (u: uPlot) => {
          if (!tooltip) return;

          const { left, top, idx } = u.cursor;

          // Hide if no valid position
          if (left == null || top == null || left < 0 || idx == null) {
            hideTooltip();
            return;
          }

          showTooltip();

          // Build tooltip content
          const xValue = formatXValue(u, idx, xLabels, isXTemporal);
          let html = `<div style="margin-bottom: 6px; font-weight: 500;">${xValue}</div>`;

          seriesNames.forEach((name, i) => {
            const seriesIdx = i + 1; // Series 0 is X axis
            const yVal = u.data[seriesIdx]?.[idx];
            const color = theme.seriesColors[i % theme.seriesColors.length];

            html += `
              <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                <span style="width: 10px; height: 10px; background: ${color}; border-radius: 2px;"></span>
                <span>${name}:</span>
                <span style="font-weight: 500;">${formatValue(yVal as number | null)}</span>
              </div>
            `;
          });

          tooltip.innerHTML = html;

          // Position tooltip - offset from cursor
          const tooltipRect = tooltip.getBoundingClientRect();
          const overRect = over.getBoundingClientRect();

          let tooltipLeft = left + 15;
          let tooltipTop = top - tooltipRect.height / 2;

          // Flip to left side if would overflow right edge
          if (left + tooltipRect.width + 20 > overRect.width) {
            tooltipLeft = left - tooltipRect.width - 15;
          }

          // Keep within vertical bounds
          if (tooltipTop < 0) tooltipTop = 0;
          if (tooltipTop + tooltipRect.height > overRect.height) {
            tooltipTop = overRect.height - tooltipRect.height;
          }

          tooltip.style.left = tooltipLeft + 'px';
          tooltip.style.top = tooltipTop + 'px';
        },
      },
    };
  }

  /**
   * Get chart padding configuration.
   * @returns Object with padding array [top, right, bottom, left] in pixels
   */
  private getChartPadding(): { padding: [number, number, number, number] } {
    return {
      padding: [16, 16, 16, 16], // top, right, bottom, left
    };
  }

  /**
   * Get cursor/crosshair options for hover interactions.
   * @param theme - Chart theme for styling
   * @returns uPlot cursor configuration
   */
  private getCursorOptions(theme: ChartTheme): uPlot.Cursor {
    return {
      show: true,
      drag: { x: false, y: false },
      focus: { prox: 30 },
      points: {
        show: true,
        size: 8,
        fill: theme.background,
        stroke: theme.foreground,
      },
    };
  }

  /**
   * Get legend options (disabled, using custom legend instead).
   * @param _theme - Chart theme (unused, kept for consistency)
   * @returns uPlot legend configuration
   */
  private getLegendOptions(_theme: ChartTheme): uPlot.Legend {
    return {
      show: false, // We'll create a custom inline legend
    };
  }

  /**
   * Create a custom legend below the chart area.
   * Displays series names with color swatches.
   * @param seriesNames - Names of the data series
   * @param theme - Chart theme for styling
   */
  private createInlineLegend(
    seriesNames: string[],
    theme: ChartTheme
  ): void {
    // Remove existing legend if any
    const existingLegend = this.container.querySelector('.uplot-legend-below');
    if (existingLegend) {
      existingLegend.remove();
    }

    // Create legend container - positioned below the chart via flexbox
    const legend = document.createElement('div');
    legend.className = 'uplot-legend-below';
    legend.style.cssText = `
      display: flex;
      justify-content: center;
      gap: 24px;
      font-family: system-ui, sans-serif;
      font-size: 12px;
      padding: 12px 0 0 0;
      flex-shrink: 0;
    `;

    // Add legend items
    seriesNames.forEach((name, index) => {
      const color = theme.seriesColors[index % theme.seriesColors.length];
      const item = document.createElement('div');
      item.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        color: ${theme.foreground};
      `;

      const swatch = document.createElement('span');
      swatch.style.cssText = `
        width: 16px;
        height: 3px;
        background: ${color};
        border-radius: 2px;
      `;

      const label = document.createElement('span');
      label.textContent = name;

      item.appendChild(swatch);
      item.appendChild(label);
      legend.appendChild(item);
    });

    // Append legend to container (below the uPlot chart)
    this.container.appendChild(legend);
  }

  /**
   * Get scales configuration for X and Y axes.
   * Configures time mode for temporal data and range for categorical data.
   * @param _type - Chart type (unused, kept for future use)
   * @param xLabels - Optional category labels for categorical X axis
   * @param isXTemporal - Whether X axis contains temporal data
   * @returns uPlot scales configuration
   */
  private getScalesOptions(_type: ChartType, xLabels?: string[], isXTemporal?: boolean): uPlot.Scales {
    const scales: uPlot.Scales = {
      x: {
        // Only use time mode for actual temporal data, not for generic numeric data
        time: isXTemporal === true,
      },
      y: {
        auto: true,
        // For bar/histogram charts, ensure y-axis starts at 0
        range: (_u, min, max) => {
          // Always include 0 for bar charts
          const lo = Math.min(0, min);
          const hi = max * 1.1; // Add 10% padding at top
          return [lo, hi];
        },
      },
    };

    // For categorical data, extend the range so bars are centered in their "cells"
    // With categories at indices 0, 1, 2, ..., n-1, we want scale from -0.5 to n-0.5
    if (xLabels && xLabels.length > 0) {
      scales.x.range = () => [-0.5, xLabels.length - 0.5];
    }

    return scales;
  }

  /**
   * Get axes configuration for X and Y axes.
   * Configures styling, grid, ticks, and value formatters.
   * @param theme - Chart theme for styling
   * @param xLabels - Optional category labels for categorical X axis
   * @param _isXTemporal - Whether X axis is temporal (unused, handled by uPlot)
   * @returns Array of uPlot axis configurations [xAxis, yAxis]
   */
  private getAxesOptions(
    theme: ChartTheme,
    xLabels?: string[],
    _isXTemporal?: boolean
  ): uPlot.Axis[] {
    const xAxis: uPlot.Axis = {
      stroke: theme.axisColor,
      grid: {
        stroke: theme.gridColor,
        width: 1,
      },
      ticks: {
        stroke: theme.gridColor,
        width: 1,
      },
      font: '12px system-ui, sans-serif',
      labelFont: '12px system-ui, sans-serif',
    };

    // Add custom value formatter and tick generator for categorical X axis
    if (xLabels && xLabels.length > 0) {
      // Custom tick generator that only creates ticks at integer category indices
      xAxis.splits = () => {
        return xLabels.map((_, i) => i);
      };

      // Custom value formatter for category labels
      xAxis.values = (_self, ticks) => {
        return ticks.map((t) => {
          const idx = Math.round(t);
          return idx >= 0 && idx < xLabels.length ? xLabels[idx] : '';
        });
      };
    }

    const yAxis: uPlot.Axis = {
      stroke: theme.axisColor,
      grid: {
        stroke: theme.gridColor,
        width: 1,
      },
      ticks: {
        stroke: theme.gridColor,
        width: 1,
      },
      font: '12px system-ui, sans-serif',
      labelFont: '12px system-ui, sans-serif',
      // Dynamic size calculation based on formatted label width
      size: (self, values, axisIdx, cycleNum) => {
        // On first cycle, use auto-sizing
        if (cycleNum === 0) return self.axes[axisIdx].size as number;

        // values are already formatted strings from our values() function
        const maxLen = Math.max(...values.map((s) => String(s).length));
        // Approximate width: ~8px per character + 16px padding for tick marks
        return Math.max(40, maxLen * 8 + 16);
      },
      // Format large numbers with K/M/B suffixes
      values: (_self, ticks) => {
        return ticks.map((v) => this.formatAxisValue(v));
      },
    };

    return [xAxis, yAxis];
  }

  /**
   * Format axis value with K/M/B suffixes for large numbers.
   * @param value - The numeric value to format
   * @returns Formatted string with appropriate suffix (K, M, B) or decimal notation
   */
  private formatAxisValue(value: number): string {
    const absValue = Math.abs(value);
    if (absValue >= 1e9) {
      return (value / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    }
    if (absValue >= 1e6) {
      return (value / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (absValue >= 1e3) {
      return (value / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    if (absValue === 0) {
      return '0';
    }
    if (absValue < 1) {
      return value.toPrecision(2);
    }
    return value.toFixed(0);
  }

  /**
   * Get series configuration based on chart type.
   * Creates series configs for each Y column with appropriate styling.
   * @param type - The chart type (line, bar, scatter, histogram)
   * @param theme - Chart theme for colors
   * @param seriesNames - Names of the Y series
   * @param _axes - Axis selection (unused, kept for future use)
   * @returns Array of uPlot series configurations
   */
  private getSeriesOptions(
    type: ChartType,
    theme: ChartTheme,
    seriesNames: string[],
    _axes: AxisSelection
  ): uPlot.Series[] {
    // First series is always X axis (no visual representation)
    const series: uPlot.Series[] = [{}];

    // Add Y series
    seriesNames.forEach((name, index) => {
      const color = theme.seriesColors[index % theme.seriesColors.length];
      const seriesConfig = this.getSeriesConfig(type, name, color, theme);
      series.push(seriesConfig);
    });

    return series;
  }

  /**
   * Get configuration for a single series based on chart type.
   * @param type - The chart type determining visual style
   * @param name - Series name for the label
   * @param color - Series color
   * @param _theme - Chart theme (unused, kept for future use)
   * @returns uPlot series configuration
   */
  private getSeriesConfig(
    type: ChartType,
    name: string,
    color: string,
    _theme: ChartTheme
  ): uPlot.Series {
    const baseConfig: uPlot.Series = {
      label: name,
      stroke: color,
      width: 2,
    };

    switch (type) {
      case 'line':
        return {
          ...baseConfig,
          fill: this.addAlpha(color, 0.1),
          points: { show: true, size: 4 },
        };

      case 'bar':
      case 'histogram':
        return {
          ...baseConfig,
          fill: this.addAlpha(color, 0.7),
          paths: this.barPathBuilder(),
          points: { show: false },
        };

      case 'scatter':
        return {
          ...baseConfig,
          fill: color,
          paths: () => null, // No line connecting points
          points: {
            show: true,
            size: 8,
            fill: color,
          },
        };

      default:
        return baseConfig;
    }
  }

  /**
   * Create bar chart path builder.
   * Returns a function that draws rectangular bars for each data point.
   * @returns uPlot path builder function for bar charts
   */
  private barPathBuilder(): uPlot.Series.PathBuilder {
    return (u: uPlot, seriesIdx: number, idx0: number, idx1: number) => {
      const xData = u.data[0];
      const yData = u.data[seriesIdx];

      const barWidth = this.calculateBarWidth(u, xData.length);

      let path = new Path2D();

      for (let i = idx0; i <= idx1; i++) {
        const x = u.valToPos(xData[i]!, 'x', true);
        const y = u.valToPos(yData[i]!, 'y', true);
        const y0 = u.valToPos(0, 'y', true);

        const left = x - barWidth / 2;
        const height = y0 - y;

        path.rect(left, y, barWidth, height);
      }

      return {
        stroke: path,
        fill: path,
      };
    };
  }

  /**
   * Calculate appropriate bar width based on data density.
   * Ensures bars don't overlap and maintain minimum/maximum widths.
   * @param u - The uPlot instance
   * @param dataLength - Number of data points
   * @returns Bar width in pixels
   */
  private calculateBarWidth(u: uPlot, dataLength: number): number {
    const plotWidth = u.bbox.width;
    const maxBarWidth = 60;
    const minBarWidth = 4;
    const barSpacing = 0.2; // 20% gap between bars

    const availableWidth = plotWidth / dataLength;
    const barWidth = availableWidth * (1 - barSpacing);

    return Math.max(minBarWidth, Math.min(maxBarWidth, barWidth));
  }

  /**
   * Add alpha channel to a color.
   * Converts hex or rgb colors to rgba format.
   * @param color - The color string (hex or rgb format)
   * @param alpha - Alpha value between 0 and 1
   * @returns rgba color string
   */
  private addAlpha(color: string, alpha: number): string {
    // Handle hex colors
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      let r: number, g: number, b: number;

      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      }

      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // Handle rgb colors
    const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
    }

    return color;
  }
}
