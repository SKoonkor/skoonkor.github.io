#!/usr/bin/env python3
"""
Linear growth factor D+(a) for a flat w0-wa cosmology.

Used for three things:

  1. the "how fast it grew" panel on the website, for all 27 grid points --
     it is analytic, so it costs nothing and does not need a simulation;
  2. converting between the two normalisation conventions (see `sigma8_for`);
  3. the sigma8 round-trip check, which divides a measured P(k) at z~9 by
     D+(a)^2 for that run's own cosmology.

Integrated as an ODE in ln a rather than the usual closed-form integral, because
the closed form assumes w = -1 and this whole demo varies w0.
"""

from __future__ import annotations

import numpy as np
from scipy.integrate import solve_ivp


def E2(a, omega_m, w0=-1.0, wa=0.0):
    """(H/H0)^2 for a flat universe with a w0-wa dark energy."""
    ode = 1.0 - omega_m
    return omega_m * a**-3 + ode * a ** (-3.0 * (1.0 + w0 + wa)) * np.exp(-3.0 * wa * (1.0 - a))


def dlnE_dlna(a, omega_m, w0=-1.0, wa=0.0, eps=1e-6):
    lo, hi = np.log(E2(a * (1 - eps), omega_m, w0, wa)), np.log(E2(a * (1 + eps), omega_m, w0, wa))
    return 0.5 * (hi - lo) / (2 * eps)


def growth(a_eval, omega_m, w0=-1.0, wa=0.0, a_init=1e-4):
    """
    D+(a), normalised so D+(1) = 1.

    d2D/dlna2 + (2 + dlnE/dlna) dD/dlna - 1.5 Omega_m(a) D = 0

    Started deep in matter domination where D ~ a, which is exact to better than
    1e-4 at a = 1e-4 for every cosmology in this grid.
    """
    a_eval = np.atleast_1d(np.asarray(a_eval, dtype=float))

    def rhs(lna, y):
        a = np.exp(lna)
        d, dp = y
        om_a = omega_m * a**-3 / E2(a, omega_m, w0, wa)
        return [dp, -(2.0 + dlnE_dlna(a, omega_m, w0, wa)) * dp + 1.5 * om_a * d]

    lna_out = np.log(np.unique(np.append(a_eval, 1.0)))
    sol = solve_ivp(
        rhs, (np.log(a_init), 0.0), [a_init, a_init],
        t_eval=lna_out, rtol=1e-10, atol=1e-14, method="DOP853",
    )
    if not sol.success:
        raise RuntimeError(sol.message)
    d = dict(zip(np.exp(sol.t).round(12), sol.y[0]))
    d1 = d[1.0]
    out = np.array([d[round(float(a), 12)] / d1 for a in a_eval])
    return out[0] if out.size == 1 else out


def growth_and_f(a_eval, omega_m, w0=-1.0, wa=0.0, a_init=1e-4):
    """
    (D+(a)/D+(1), f(a)) where f = dlnD/dlna is the linear growth rate.

    f comes straight out of the same ODE solution rather than from a finite
    difference of D: the integrator already carries dD/dlna as its second state
    variable, so f = (dD/dlna)/D is exact to the solver tolerance.
    """
    a_eval = np.atleast_1d(np.asarray(a_eval, dtype=float))

    def rhs(lna, y):
        a = np.exp(lna)
        d, dp = y
        om_a = omega_m * a**-3 / E2(a, omega_m, w0, wa)
        return [dp, -(2.0 + dlnE_dlna(a, omega_m, w0, wa)) * dp + 1.5 * om_a * d]

    lna_out = np.log(np.unique(np.append(a_eval, 1.0)))
    sol = solve_ivp(rhs, (np.log(a_init), 0.0), [a_init, a_init],
                    t_eval=lna_out, rtol=1e-10, atol=1e-14, method="DOP853")
    if not sol.success:
        raise RuntimeError(sol.message)
    a_sol = np.exp(sol.t).round(12)
    d = dict(zip(a_sol, sol.y[0]))
    dp = dict(zip(a_sol, sol.y[1]))
    d1 = d[1.0]
    keys = [round(float(x), 12) for x in a_eval]
    D = np.array([d[k] / d1 for k in keys])
    f = np.array([dp[k] / d[k] for k in keys])
    return D, f


def sigma8_for(sigma8_ref, omega_m, w0, a_ini, omega_m_ref=0.30, w0_ref=-1.0):
    """
    The sigma8 to hand MUSIC so the IC amplitude at `a_ini` matches the reference.

    MUSIC normalises sigma8 at z=0 and then back-scales the IC by D(a_ini)/D(1),
    so the amplitude actually laid down is sigma8 * D(a_ini)/D(1). Matching that
    across cosmologies -- rather than matching at z=0 -- is what makes the
    dark-energy axis visible: otherwise every w0 gives the same clustering today
    by construction.
    """
    ref = growth(a_ini, omega_m_ref, w0_ref)
    mine = growth(a_ini, omega_m, w0)
    return sigma8_ref * ref / mine


if __name__ == "__main__":
    a_ini = 1.0 / 51.0
    print(f"  D+(z=50)/D+(0), a_ini = {a_ini:.9f}")
    for w0 in (-0.7, -1.0, -1.3):
        print(f"    Om=0.30 w0={w0:+.1f}:  {growth(a_ini, 0.30, w0):.5f}")
    for om in (0.15, 0.30, 0.45):
        print(f"    Om={om:.2f} w0=-1.0:  {growth(a_ini, om, -1.0):.5f}")
    print("\n  sigma8 to hand MUSIC for 'matched at the beginning' (ref Om=0.30 w0=-1.0 s8=0.80):")
    for w0 in (-0.7, -1.0, -1.3):
        s = sigma8_for(0.80, 0.30, w0, a_ini)
        print(f"    w0={w0:+.1f}: sigma_8 = {s:.4f}   -> sigma8(z=0) becomes {s:.4f}")
