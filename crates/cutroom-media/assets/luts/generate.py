#!/usr/bin/env python3
"""Generate Cutroom's built-in de-log LUTs.

slog3_to_rec709.cube: S-Log3/S-Gamut3 -> Rec.709 SDR (33^3 lattice).

Math sources (published by the manufacturers):
- S-Log3 inverse EOTF: Sony "Technical Summary for S-Gamut3.Cine/S-Log3
  and S-Gamut3/S-Log3":
      if x >= 171.2102946929/1023:
          L = 10^((x*1023 - 420)/261.5) * 0.19 - 0.01
      else:
          L = (x*1023 - 95) * 0.01125/(171.2102946929 - 95)
- S-Gamut3 primaries (Sony): R(0.730, 0.280) G(0.140, 0.855)
  B(0.100, -0.050), D65 white. Converted to Rec.709 via XYZ using the
  standard primaries/white-point matrix derivation.
- Rec.709 OETF (BT.709): V = 1.099*L^0.45 - 0.099 (L >= 0.018),
  V = 4.5*L below.

The LUT is an approximation for convenience; colorists should use
manufacturer .cube LUTs for critical work.
"""

import math
import os

SIZE = 33


def slog3_to_linear(x: float) -> float:
    if x >= 171.2102946929 / 1023.0:
        return (10.0 ** ((x * 1023.0 - 420.0) / 261.5)) * 0.19 - 0.01
    return (x * 1023.0 - 95.0) * 0.01125 / (171.2102946929 - 95.0)


def rgb_to_xyz_matrix(r, g, b, w):
    # primaries as (x, y); white as (x, y)
    def xyz_of(p):
        x, y = p
        return (x / y, 1.0, (1.0 - x - y) / y)

    xr, yr, zr = xyz_of(r)
    xg, yg, zg = xyz_of(g)
    xb, yb, zb = xyz_of(b)
    xw, yw, zw = xyz_of(w)
    # Solve M * s = w for per-primary scale factors (3x3, Cramer's rule).
    m = ((xr, xg, xb), (yr, yg, yb), (zr, zg, zb))

    def det3(a):
        return (
            a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
            - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
            + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
        )

    def replace_col(a, col, vec):
        return tuple(
            tuple(vec[i] if j == col else a[i][j] for j in range(3)) for i in range(3)
        )

    d = det3(m)
    wv = (xw, yw, zw)
    s = tuple(det3(replace_col(m, c, wv)) / d for c in range(3))
    return (
        (xr * s[0], xg * s[1], xb * s[2]),
        (yr * s[0], yg * s[1], yb * s[2]),
        (zr * s[0], zg * s[1], zb * s[2]),
    )


def invert3(m):
    def det3(a):
        return (
            a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
            - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
            + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
        )

    d = det3(m)
    # adjugate
    adj = (
        (
            m[1][1] * m[2][2] - m[1][2] * m[2][1],
            m[0][2] * m[2][1] - m[0][1] * m[2][2],
            m[0][1] * m[1][2] - m[0][2] * m[1][1],
        ),
        (
            m[1][2] * m[2][0] - m[1][0] * m[2][2],
            m[0][0] * m[2][2] - m[0][2] * m[2][0],
            m[0][2] * m[1][0] - m[0][0] * m[1][2],
        ),
        (
            m[1][0] * m[2][1] - m[1][1] * m[2][0],
            m[0][1] * m[2][0] - m[0][0] * m[2][1],
            m[0][0] * m[1][1] - m[0][1] * m[1][0],
        ),
    )
    return tuple(tuple(adj[i][j] / d for j in range(3)) for i in range(3))


def mat3_vec(m, v):
    return tuple(
        m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2] for i in range(3)
    )


def mat3_mul(a, b):
    return tuple(
        tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3))
        for i in range(3)
    )


def rec709_oetf(l: float) -> float:
    if l < 0.018:
        v = 4.5 * l
    else:
        v = 1.099 * (l ** 0.45) - 0.099
    return min(1.0, max(0.0, v))


def main() -> None:
    d65 = (0.3127, 0.3290)
    sgamut3 = ((0.730, 0.280), (0.140, 0.855), (0.100, -0.050))
    rec709 = ((0.640, 0.330), (0.300, 0.600), (0.150, 0.060))
    sgamut3_to_xyz = rgb_to_xyz_matrix(*sgamut3, d65)
    xyz_to_rec709 = invert3(rgb_to_xyz_matrix(*rec709, d65))
    gamut_matrix = mat3_mul(xyz_to_rec709, sgamut3_to_xyz)

    lines = [
        'TITLE "Cutroom built-in S-Log3/S-Gamut3 to Rec.709 (approximate)"',
        f"LUT_3D_SIZE {SIZE}",
        "DOMAIN_MIN 0.0 0.0 0.0",
        "DOMAIN_MAX 1.0 1.0 1.0",
        "",
    ]
    prev_gray = -1.0
    for bi in range(SIZE):
        for gi in range(SIZE):
            for ri in range(SIZE):
                r, g, b = ri / (SIZE - 1), gi / (SIZE - 1), bi / (SIZE - 1)
                lin = tuple(slog3_to_linear(c) for c in (r, g, b))
                rec = mat3_vec(gamut_matrix, lin)
                out = tuple(rec709_oetf(c) for c in rec)
                lines.append(f"{out[0]:.6f} {out[1]:.6f} {out[2]:.6f}")
                if ri == gi == bi:
                    gray = out[0]
                    assert gray >= prev_gray - 1e-9, "gray ramp must be monotonic"
                    prev_gray = gray

    # Sanity: 18% gray (S-Log3 0.4106) -> Rec.709 ~0.41; black -> ~0.
    def at(code):
        lin = slog3_to_linear(code)
        return rec709_oetf(mat3_vec(gamut_matrix, (lin, lin, lin))[0])

    gray18 = at(420.0 / 1023.0)
    black = at(95.0 / 1023.0)
    assert abs(gray18 - 0.41) < 0.03, f"18% gray maps to {gray18}"
    assert black < 0.01, f"black maps to {black}"
    print(f"sanity: 18% gray -> {gray18:.4f}, black -> {black:.4f}, white -> {at(1.0):.4f}")

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "slog3_to_rec709.cube")
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"wrote {out_path} ({os.path.getsize(out_path)} bytes)")


if __name__ == "__main__":
    main()
