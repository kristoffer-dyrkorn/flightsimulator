import * as DataTables from "./dataTables.js"
import * as HeaderTables from "./headerTables.js"
import { interpolate } from "./interpolate.js"

function _Cx(alpha, beta, dele) {
  return interpolate(
    [HeaderTables.ALPHA1, HeaderTables.BETA1, HeaderTables.DH1],
    DataTables.CX0120_ALPHA1_BETA1_DH1_201,
    [alpha, beta, dele],
    [20, 19, 5]
  )
}

function _Cz(alpha, beta, dele) {
  return interpolate(
    [HeaderTables.ALPHA1, HeaderTables.BETA1, HeaderTables.DH1],
    DataTables.CZ0120_ALPHA1_BETA1_DH1_301,
    [alpha, beta, dele],
    [20, 19, 5]
  )
}

function _Cm(alpha, beta, dele) {
  return interpolate(
    [HeaderTables.ALPHA1, HeaderTables.BETA1, HeaderTables.DH1],
    DataTables.CM0120_ALPHA1_BETA1_DH1_101,
    [alpha, beta, dele],
    [20, 19, 5]
  )
}

function _Cy(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA1, HeaderTables.BETA1],
    DataTables.CY0320_ALPHA1_BETA1_401,
    [alpha, beta],
    [20, 19]
  )
}

function _Cn(alpha, beta, dele) {
  return interpolate(
    [HeaderTables.ALPHA1, HeaderTables.BETA1, HeaderTables.DH2],
    DataTables.CN0120_ALPHA1_BETA1_DH2_501,
    [alpha, beta, dele],
    [20, 19, 3]
  )
}

function _Cl(alpha, beta, dele) {
  return interpolate(
    [HeaderTables.ALPHA1, HeaderTables.BETA1, HeaderTables.DH2],
    DataTables.CL0120_ALPHA1_BETA1_DH2_601,
    [alpha, beta, dele],
    [20, 19, 3]
  )
}

function _Cx_lef(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA2, HeaderTables.BETA1],
    DataTables.CX0820_ALPHA2_BETA1_202,
    [alpha, beta],
    [14, 19]
  )
}

function _Cz_lef(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA2, HeaderTables.BETA1],
    DataTables.CZ0820_ALPHA2_BETA1_302,
    [alpha, beta],
    [14, 19]
  )
}

function _Cm_lef(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA2, HeaderTables.BETA1],
    DataTables.CM0820_ALPHA2_BETA1_102,
    [alpha, beta],
    [14, 19]
  )
}

function _Cy_lef(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA2, HeaderTables.BETA1],
    DataTables.CY0820_ALPHA2_BETA1_402,
    [alpha, beta],
    [14, 19]
  )
}

function _Cn_lef(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA2, HeaderTables.BETA1],
    DataTables.CN0820_ALPHA2_BETA1_502,
    [alpha, beta],
    [14, 19]
  )
}

function _Cl_lef(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA2, HeaderTables.BETA1],
    DataTables.CL0820_ALPHA2_BETA1_602,
    [alpha, beta],
    [14, 19]
  )
}

function _CXq(alpha) {
  return interpolate([HeaderTables.ALPHA1], DataTables.CX1120_ALPHA1_204, [alpha], [20])
}

export function _CXspbr(alpha) {
  return interpolate([HeaderTables.ALPHA1], DataTables.CX_ALPHA1_SPBR, [alpha], [20])
}

function _CZq(alpha) {
  return interpolate([HeaderTables.ALPHA1], DataTables.CZ1120_ALPHA1_304, [alpha], [20])
}

export function _CZspbr(alpha) {
  return interpolate([HeaderTables.ALPHA1], DataTables.CZ_ALPHA1_SPBR, [alpha], [20])
}

function _CMq(alpha) {
  return interpolate([HeaderTables.ALPHA1], DataTables.CM1120_ALPHA1_104, [alpha], [20])
}

export function _CMsbpr(alpha) {
  return interpolate([HeaderTables.ALPHA1], DataTables.CM_ALPHA1_SPBR, [alpha], [20])
}

function _CYp(alpha) {
  return interpolate([HeaderTables.ALPHA1], DataTables.CY1220_ALPHA1_408, [alpha], [20])
}

function _CYr(alpha) {
  return interpolate([HeaderTables.ALPHA1], DataTables.CY1320_ALPHA1_406, [alpha], [20])
}

function _CNr(alpha) {
  return interpolate([HeaderTables.ALPHA1], DataTables.CN1320_ALPHA1_506, [alpha], [20])
}

function _CNp(alpha) {
  return interpolate([HeaderTables.ALPHA1], DataTables.CN1220_ALPHA1_508, [alpha], [20])
}

function _CLp(alpha) {
  return interpolate([HeaderTables.ALPHA1], DataTables.CL1220_ALPHA1_608, [alpha], [20])
}

function _CLr(alpha) {
  return interpolate([HeaderTables.ALPHA1], DataTables.CL1320_ALPHA1_606, [alpha], [20])
}

function _delta_CXq_lef(alpha) {
  return interpolate([HeaderTables.ALPHA2], DataTables.CX1420_ALPHA2_205, [alpha], [14])
}

function _delta_CYr_lef(alpha) {
  return interpolate([HeaderTables.ALPHA2], DataTables.CY1620_ALPHA2_407, [alpha], [14])
}

function _delta_CYp_lef(alpha) {
  return interpolate([HeaderTables.ALPHA2], DataTables.CY1520_ALPHA2_409, [alpha], [14])
}

function _delta_CZq_lef(alpha) {
  return interpolate([HeaderTables.ALPHA2], DataTables.CZ1420_ALPHA2_305, [alpha], [14])
}

function _delta_CLr_lef(alpha) {
  return interpolate([HeaderTables.ALPHA2], DataTables.CL1620_ALPHA2_607, [alpha], [14])
}

function _delta_CLp_lef(alpha) {
  return interpolate([HeaderTables.ALPHA2], DataTables.CL1520_ALPHA2_609, [alpha], [14])
}

function _delta_CMq_lef(alpha) {
  return interpolate([HeaderTables.ALPHA2], DataTables.CM1420_ALPHA2_105, [alpha], [14])
}

function _delta_CNr_lef(alpha) {
  return interpolate([HeaderTables.ALPHA2], DataTables.CN1620_ALPHA2_507, [alpha], [14])
}

function _delta_CNp_lef(alpha) {
  return interpolate([HeaderTables.ALPHA2], DataTables.CN1520_ALPHA2_509, [alpha], [14])
}

function _Cy_r30(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA1, HeaderTables.BETA1],
    DataTables.CY0720_ALPHA1_BETA1_405,
    [alpha, beta],
    [20, 19]
  )
}

function _Cn_r30(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA1, HeaderTables.BETA1],
    DataTables.CN0720_ALPHA1_BETA1_503,
    [alpha, beta],
    [20, 19]
  )
}

function _Cl_r30(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA1, HeaderTables.BETA1],
    DataTables.CL0720_ALPHA1_BETA1_603,
    [alpha, beta],
    [20, 19]
  )
}

function _Cy_a20(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA1, HeaderTables.BETA1],
    DataTables.CY0620_ALPHA1_BETA1_403,
    [alpha, beta],
    [20, 19]
  )
}

function _Cy_a20_lef(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA2, HeaderTables.BETA1],
    DataTables.CY0920_ALPHA2_BETA1_404,
    [alpha, beta],
    [14, 19]
  )
}

function _Cn_a20(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA1, HeaderTables.BETA1],
    DataTables.CN0620_ALPHA1_BETA1_504,
    [alpha, beta],
    [20, 19]
  )
}

function _Cn_a20_lef(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA2, HeaderTables.BETA1],
    DataTables.CN0920_ALPHA2_BETA1_505,
    [alpha, beta],
    [14, 19]
  )
}

function _Cl_a20(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA1, HeaderTables.BETA1],
    DataTables.CL0620_ALPHA1_BETA1_604,
    [alpha, beta],
    [20, 19]
  )
}

function _Cl_a20_lef(alpha, beta) {
  return interpolate(
    [HeaderTables.ALPHA2, HeaderTables.BETA1],
    DataTables.CL0920_ALPHA2_BETA1_605,
    [alpha, beta],
    [14, 19]
  )
}

function _delta_CNbeta(alpha) {
  return interpolate([HeaderTables.ALPHA1], DataTables.CN9999_ALPHA1_brett, [alpha], [20])
}

function _delta_CLbeta(alpha) {
  return interpolate([HeaderTables.ALPHA1], DataTables.CL9999_ALPHA1_brett, [alpha], [20])
}

function _delta_Cm(alpha) {
  return interpolate([HeaderTables.ALPHA1], DataTables.CM9999_ALPHA1_brett, [alpha], [20])
}

function _delta_Cm_ds(alpha, dele) {
  return interpolate([HeaderTables.ALPHA1, HeaderTables.DH3], DataTables.CM9999_ALPHA1_DH3, [alpha, dele], [20, 7])
}

function _eta_el(el) {
  return interpolate([HeaderTables.DH1], DataTables.ETA_DH1_brett, [el], [5])
}

export function hifi_C(alpha, beta, el) {
  return [
    _Cx(alpha, beta, el),
    _Cz(alpha, beta, el),
    _Cm(alpha, beta, el),
    _Cy(alpha, beta),
    _Cn(alpha, beta, el),
    _Cl(alpha, beta, el),
  ]
}

export function hifi_damping(alpha) {
  return [
    _CXq(alpha),
    _CYr(alpha),
    _CYp(alpha),
    _CZq(alpha),
    _CLr(alpha),
    _CLp(alpha),
    _CMq(alpha),
    _CNr(alpha),
    _CNp(alpha),
  ]
}

export function hifi_C_lef(alpha, beta) {
  return [
    _Cx_lef(alpha, beta) - _Cx(alpha, beta, 0),
    _Cz_lef(alpha, beta) - _Cz(alpha, beta, 0),
    _Cm_lef(alpha, beta) - _Cm(alpha, beta, 0),
    _Cy_lef(alpha, beta) - _Cy(alpha, beta),
    _Cn_lef(alpha, beta) - _Cn(alpha, beta, 0),
    _Cl_lef(alpha, beta) - _Cl(alpha, beta, 0),
  ]
}

export function hifi_damping_lef(alpha) {
  return [
    _delta_CXq_lef(alpha),
    _delta_CYr_lef(alpha),
    _delta_CYp_lef(alpha),
    _delta_CZq_lef(alpha),
    _delta_CLr_lef(alpha),
    _delta_CLp_lef(alpha),
    _delta_CMq_lef(alpha),
    _delta_CNr_lef(alpha),
    _delta_CNp_lef(alpha),
  ]
}

export function hifi_rudder(alpha, beta) {
  return [
    _Cy_r30(alpha, beta) - _Cy(alpha, beta),
    _Cn_r30(alpha, beta) - _Cn(alpha, beta, 0),
    _Cl_r30(alpha, beta) - _Cl(alpha, beta, 0),
  ]
}

export function hifi_ailerons(alpha, alpha_lef, beta) {
  const value_0 = _Cy_a20(alpha, beta) - _Cy(alpha, beta)
  const value_2 = _Cn_a20(alpha, beta) - _Cn(alpha, beta, 0)
  const value_4 = _Cl_a20(alpha, beta) - _Cl(alpha, beta, 0)
  return [
    value_0,
    _Cy_a20_lef(alpha_lef, beta) - _Cy_lef(alpha_lef, beta) - value_0,
    value_2,
    _Cn_a20_lef(alpha_lef, beta) - _Cn_lef(alpha_lef, beta) - value_2,
    value_4,
    _Cl_a20_lef(alpha_lef, beta) - _Cl_lef(alpha_lef, beta) - value_4,
  ]
}

export function hifi_other_coeffs(alpha, el) {
  return [_delta_CNbeta(alpha), _delta_CLbeta(alpha), _delta_Cm(alpha), _eta_el(el), _delta_Cm_ds(alpha, el)]
}
