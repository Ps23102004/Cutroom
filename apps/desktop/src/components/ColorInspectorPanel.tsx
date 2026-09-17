import React, { useState } from 'react';
import { Button, Select } from '@cutroom/ui';
import {
  Clip,
  ClipColor,
  ColorGradeState,
  InputColorSpace,
  neutralClipColor,
} from '../lib/contracts';
import { dispatchNativeCommand, isNativeAvailable, NATIVE_COMMANDS } from '../lib/native';

const INPUT_COLOR_SPACE_OPTIONS: { value: InputColorSpace; label: string }[] = [
  { value: 'auto', label: 'Auto (probe the file)' },
  { value: 'rec709', label: 'Rec.709 SDR' },
  { value: 'bt2020_sdr', label: 'BT.2020 SDR' },
  { value: 's_log3', label: 'Sony S-Log3' },
  { value: 'v_log', label: 'Panasonic V-Log' },
  { value: 'c_log3', label: 'Canon C-Log3' },
  { value: 'pq_hdr', label: 'PQ / ST.2084 HDR' },
  { value: 'hlg_hdr', label: 'HLG HDR' },
];

interface LutPickResult {
  path: string;
  sha256: string;
  size: number;
  title?: string | null;
}

interface ColorInspectorPanelProps {
  clip: Clip;
  projectId: string;
  updateClipColor: (clipId: string, color: ClipColor) => Promise<void>;
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: '12px',
  marginBottom: '4px',
};

const sliderStyle: React.CSSProperties = { width: '100%' };

function formatNumber(value: number, digits: number): string {
  return value.toFixed(digits);
}

export const ColorInspectorPanel: React.FC<ColorInspectorPanelProps> = ({
  clip,
  projectId,
  updateClipColor,
}) => {
  const initial: ClipColor = clip.colorGrade ?? neutralClipColor();
  const [inputColorSpace, setInputColorSpace] = useState<InputColorSpace>(initial.inputColorSpace);
  const [grade, setGrade] = useState<ColorGradeState>(initial.grade);
  const [isApplying, setIsApplying] = useState(false);
  const [isPickingLut, setIsPickingLut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedNote, setAppliedNote] = useState<string | null>(null);

  const nativeAvailable = isNativeAvailable();

  const setGradeField = (field: keyof ColorGradeState, value: number) => {
    setGrade((prev) => ({ ...prev, [field]: value }));
    setAppliedNote(null);
  };

  const clampGrade = (g: ColorGradeState): ColorGradeState => ({
    exposureEv: Math.min(3, Math.max(-3, g.exposureEv)),
    contrast: Math.min(4, Math.max(0.1, g.contrast)),
    saturation: Math.min(3, Math.max(0, g.saturation)),
    wbTemp: Math.min(100, Math.max(-100, g.wbTemp)),
    wbTint: Math.min(100, Math.max(-100, g.wbTint)),
    lut: g.lut,
  });

  const handleApply = async () => {
    setError(null);
    setAppliedNote(null);
    setIsApplying(true);
    try {
      const color: ClipColor = { inputColorSpace, grade: clampGrade(grade) };
      await updateClipColor(clip.id, color);
      setAppliedNote('Grade written to the composition.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Could not apply color grade: ${msg}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleReset = () => {
    const neutral = neutralClipColor();
    setInputColorSpace(neutral.inputColorSpace);
    setGrade(neutral.grade);
    setAppliedNote(null);
    setError(null);
  };

  const handlePickLut = async () => {
    setError(null);
    setIsPickingLut(true);
    try {
      const res = await dispatchNativeCommand<LutPickResult>({
        command: NATIVE_COMMANDS.LUT_PICK,
        project_id: projectId,
        payload: { openFileDialog: true },
      });
      if (!res.ok) {
        setError(`LUT picker failed: ${res.error.message}`);
        return;
      }
      setGrade((prev) => ({
        ...prev,
        lut: { path: res.data.path, expectedSha256: res.data.sha256 },
      }));
      setAppliedNote(null);
    } finally {
      setIsPickingLut(false);
    }
  };

  const handleRemoveLut = () => {
    setGrade((prev) => ({ ...prev, lut: null }));
    setAppliedNote(null);
  };

  const lutFileName = grade.lut ? grade.lut.path.split(/[\\/]/).pop() ?? grade.lut.path : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary, #FAF8FF)' }}>
        Color Grade — {clip.name}
      </h4>

      {error && (
        <div
          role="alert"
          style={{
            padding: '8px 10px',
            backgroundColor: 'rgba(224, 108, 117, 0.12)',
            border: '1px solid var(--destructive, #E06C75)',
            borderRadius: '6px',
            color: 'var(--destructive, #E06C75)',
            fontSize: '12px',
          }}
        >
          {error}
        </div>
      )}
      {appliedNote && (
        <div style={{ fontSize: '12px', color: 'var(--accent-green, #7FD88A)' }}>
          {appliedNote}
        </div>
      )}

      <Select
        label="Input color space"
        value={inputColorSpace}
        onChange={(e) => {
          setInputColorSpace(e.target.value as InputColorSpace);
          setAppliedNote(null);
        }}
        options={INPUT_COLOR_SPACE_OPTIONS}
      />

      {(inputColorSpace === 'v_log' || inputColorSpace === 'c_log3') && (
        <div style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9D95B0)', lineHeight: 1.5 }}>
          V-Log and C-Log3 have no built-in de-log LUT — attach the manufacturer&rsquo;s .cube
          LUT below, or the render will be rejected. Only S-Log3 ships with a built-in de-log.
        </div>
      )}
      {inputColorSpace === 'hlg_hdr' && (
        <div style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9D95B0)', lineHeight: 1.5 }}>
          HLG sources are tone-mapped to SDR. HDR10 output only supports PQ inputs.
        </div>
      )}

      <div>
        <div style={labelStyle}>
          <span style={{ color: 'var(--text-secondary, #C2BCCC)' }}>Exposure</span>
          <span className="font-mono">{formatNumber(grade.exposureEv, 1)} EV</span>
        </div>
        <input
          aria-label="Exposure"
          type="range"
          min="-3"
          max="3"
          step="0.1"
          value={grade.exposureEv}
          onChange={(e) => setGradeField('exposureEv', parseFloat(e.target.value))}
          style={sliderStyle}
        />
      </div>

      <div>
        <div style={labelStyle}>
          <span style={{ color: 'var(--text-secondary, #C2BCCC)' }}>Contrast</span>
          <span className="font-mono">{formatNumber(grade.contrast, 2)}</span>
        </div>
        <input
          aria-label="Contrast"
          type="range"
          min="0.1"
          max="4"
          step="0.05"
          value={grade.contrast}
          onChange={(e) => setGradeField('contrast', parseFloat(e.target.value))}
          style={sliderStyle}
        />
      </div>

      <div>
        <div style={labelStyle}>
          <span style={{ color: 'var(--text-secondary, #C2BCCC)' }}>Saturation</span>
          <span className="font-mono">{formatNumber(grade.saturation, 2)}</span>
        </div>
        <input
          aria-label="Saturation"
          type="range"
          min="0"
          max="3"
          step="0.05"
          value={grade.saturation}
          onChange={(e) => setGradeField('saturation', parseFloat(e.target.value))}
          style={sliderStyle}
        />
      </div>

      <div>
        <div style={labelStyle}>
          <span style={{ color: 'var(--text-secondary, #C2BCCC)' }}>White balance temperature</span>
          <span className="font-mono">{formatNumber(grade.wbTemp, 0)}</span>
        </div>
        <input
          aria-label="White balance temperature"
          type="range"
          min="-100"
          max="100"
          step="1"
          value={grade.wbTemp}
          onChange={(e) => setGradeField('wbTemp', parseInt(e.target.value, 10))}
          style={sliderStyle}
        />
      </div>

      <div>
        <div style={labelStyle}>
          <span style={{ color: 'var(--text-secondary, #C2BCCC)' }}>White balance tint</span>
          <span className="font-mono">{formatNumber(grade.wbTint, 0)}</span>
        </div>
        <input
          aria-label="White balance tint"
          type="range"
          min="-100"
          max="100"
          step="1"
          value={grade.wbTint}
          onChange={(e) => setGradeField('wbTint', parseInt(e.target.value, 10))}
          style={sliderStyle}
        />
      </div>

      <div>
        <div style={{ ...labelStyle, marginBottom: '6px' }}>
          <span style={{ color: 'var(--text-secondary, #C2BCCC)' }}>Custom .cube LUT</span>
        </div>
        {lutFileName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              className="font-mono"
              style={{ fontSize: '11px', color: 'var(--text-primary, #FAF8FF)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={grade.lut?.path}
            >
              {lutFileName}
            </span>
            <Button size="sm" variant="ghost" onClick={handleRemoveLut}>
              Remove
            </Button>
          </div>
        ) : (
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9D95B0)', marginBottom: '6px' }}>
            No LUT attached.
          </div>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={handlePickLut}
          isLoading={isPickingLut}
          disabled={!nativeAvailable}
          title={nativeAvailable ? 'Pick a .cube LUT through the native file dialog' : 'LUT picking requires the connected desktop engine'}
        >
          Pick .cube LUT
        </Button>
        {!nativeAvailable && (
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary-panel, #9D95B0)', marginTop: '6px' }}>
            LUT picking is unavailable in browser preview mode — the .cube file must be
            chosen through the desktop app&rsquo;s native file dialog.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
        <Button variant="primary" size="sm" onClick={handleApply} isLoading={isApplying}>
          Apply grade to clip
        </Button>
        <Button variant="ghost" size="sm" onClick={handleReset}>
          Reset
        </Button>
      </div>
    </div>
  );
};

export default ColorInspectorPanel;
