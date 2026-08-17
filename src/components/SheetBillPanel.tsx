import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { HallParameters, CladdingParameters, CalculationResults, Opening } from '../types';
import { computeSheetBill } from '../utils/sheet-bill';

interface SheetBillPanelProps {
  params: HallParameters;
  cladding: CladdingParameters;
  results: CalculationResults;
  openings?: Opening[];
}

export function SheetBillPanel({ params, cladding, results, openings }: SheetBillPanelProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const billResult = useMemo(
    () => computeSheetBill(params, cladding, results, openings),
    [params, cladding, results, openings]
  );

  return (
    <div className="space-y-3">
      <div
        className="flex justify-between items-center cursor-pointer"
        onClick={() => setCollapsed(!collapsed)}
      >
        <h3 className="text-xs font-sans font-bold text-text-primary uppercase tracking-wider border-b border-border pb-1 flex-1">
          {t('sheetBill.title')}
        </h3>
        <span className="text-xs text-text-secondary ml-2">
          {collapsed ? '\u25B6' : '\u25BC'}
        </span>
      </div>

      {!collapsed && (
        <div className="space-y-4">
          {/* Bill of materials table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-sans">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 text-text-secondary font-normal">{t('sheetBill.columns.type')}</th>
                  <th className="text-right py-1 text-text-secondary font-normal">{t('sheetBill.columns.thickness')}</th>
                  <th className="text-right py-1 text-text-secondary font-normal">{t('sheetBill.columns.module')}</th>
                  <th className="text-right py-1 text-text-secondary font-normal">{t('sheetBill.columns.length')}</th>
                  <th className="text-right py-1 text-text-secondary font-normal">{t('sheetBill.columns.count')}</th>
                </tr>
              </thead>
              <tbody>
                {billResult.items.map((item, idx) => (
                  <tr key={idx} className="border-b border-border/50">
                    <td className="py-1.5 text-text-primary">{t(item.type)}</td>
                    <td className="py-1.5 text-right text-text-secondary">
                      {item.thickness !== null ? `${item.thickness} mm` : '-'}
                    </td>
                    <td className="py-1.5 text-right text-text-secondary">{item.moduleWidth} mm</td>
                    <td className="py-1.5 text-right text-text-secondary">{item.length} mm</td>
                    <td className="py-1.5 text-right text-text-primary font-medium">
                      {item.count} {t('sheetBill.columns.pcs')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Total surfaces */}
          <div className="space-y-1.5 border-t border-border pt-2">
            <div className="flex justify-between text-xs font-sans">
              <span className="text-text-secondary">{t('sheetBill.totalWallSurface')}</span>
              <span className="text-text-primary font-bold">
                {billResult.totalWallSurfaceGross.toFixed(2)} m&sup2;
              </span>
            </div>
            <div className="flex justify-between text-xs font-sans">
              <span className="text-text-secondary">{t('sheetBill.totalRoofSurface')}</span>
              <span className="text-text-primary font-bold">
                {billResult.totalRoofSurfaceGross.toFixed(2)} m&sup2;
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
