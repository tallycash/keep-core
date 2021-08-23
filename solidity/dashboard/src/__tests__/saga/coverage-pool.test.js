import { expectSaga } from "redux-saga-test-plan"
import { throwError } from "redux-saga-test-plan/providers"
import * as matchers from "redux-saga-test-plan/matchers"
import { call, select } from "redux-saga/effects"
import BigNumber from "bignumber.js"
import {
  watchFetchTvl,
  watchFetchAPY,
  watchFetchCovPoolData,
  subscribeToCovTokenTransferEvent,
} from "../../sagas/coverage-pool"
import selectors from "../../sagas/selectors"

import coveragePoolReducer, {
  coveragePoolInitialData,
} from "../../reducers/coverage-pool"
import { KEEP, Token } from "../../utils/token.utils"
import {
  fetchTvlRequest,
  fetchTvlStart,
  fetchTvlSuccess,
  COVERAGE_POOL_FETCH_TVL_ERROR,
  fetchAPYRequest,
  fetchAPYStart,
  fetchAPYSuccess,
  COVERAGE_POOL_FETCH_APY_ERROR,
  fetchCovPoolDataRequest,
  fetchCovPoolDataStart,
  fetchCovPoolDataSuccess,
  COVERAGE_POOL_FETCH_COV_POOL_DATA_ERROR,
  covTokenUpdated,
  COVERAGE_POOL_COV_TOKEN_TRANSFER_EVENT_EMITTED,
} from "../../actions/coverage-pool"
import { Keep } from "../../contracts"
import { ZERO_ADDRESS } from "../../utils/ethereum.utils"
import { add } from "../../utils/arithmetics.utils"

describe("Coverage pool saga test", () => {
  describe("Fetch tvl watcher", () => {
    const tvl = KEEP.fromTokenUnit(100000)
    const keepInUSD = new BigNumber(0.5)
    const totalAllocatedRewards = KEEP.fromTokenUnit(200000)
    const tvlInUSD = keepInUSD.multipliedBy(KEEP.toTokenUnit(tvl)).toFormat(2)

    it("should fetch tvl data correctly", () => {
      return expectSaga(watchFetchTvl)
        .withReducer(coveragePoolReducer)
        .provide([
          [call(Keep.coveragePoolV1.totalValueLocked), tvl],
          [call(Keep.exchangeService.getKeepTokenPriceInUSD), keepInUSD],
          [
            call(Keep.coveragePoolV1.totalAllocatedRewards),
            totalAllocatedRewards,
          ],
        ])
        .dispatch(fetchTvlRequest())
        .put(fetchTvlStart())
        .put(
          fetchTvlSuccess({
            tvl,
            tvlInUSD,
            totalAllocatedRewards,
          })
        )
        .hasFinalState({
          ...coveragePoolInitialData,
          totalValueLocked: tvl,
          totalValueLockedInUSD: tvlInUSD,
          isTotalValueLockedFetching: false,
          tvlError: null,
          totalAllocatedRewards,
        })
        .run()
    })

    it("should log error if an any Keep lib function has failed", () => {
      const mockedError = new Error("Fake error")
      return expectSaga(watchFetchTvl)
        .withReducer(coveragePoolReducer)
        .provide([
          [call(Keep.coveragePoolV1.totalValueLocked), throwError(mockedError)],
          [call(Keep.exchangeService.getKeepTokenPriceInUSD), keepInUSD],
          [
            call(Keep.coveragePoolV1.totalAllocatedRewards),
            totalAllocatedRewards,
          ],
        ])
        .dispatch(fetchTvlRequest())
        .put(fetchTvlStart())
        .put({
          type: COVERAGE_POOL_FETCH_TVL_ERROR,
          payload: { error: mockedError.message },
        })
        .hasFinalState({
          ...coveragePoolInitialData,
          tvlError: mockedError.message,
        })
        .run()
    })
  })

  describe("Fetch apy watcher", () => {
    const apy = 0.25

    it("should fetch apy data correctly", () => {
      return expectSaga(watchFetchAPY)
        .withReducer(coveragePoolReducer)
        .provide([[call(Keep.coveragePoolV1.apy), apy]])
        .dispatch(fetchAPYRequest())
        .put(fetchAPYStart())
        .put(fetchAPYSuccess(apy))
        .hasFinalState({
          ...coveragePoolInitialData,
          apy,
        })
        .run()
    })

    it("should log error if function has failed", () => {
      const mockedError = new Error("Fake error")
      return expectSaga(watchFetchAPY)
        .withReducer(coveragePoolReducer)
        .provide([[call(Keep.coveragePoolV1.apy), throwError(mockedError)]])
        .dispatch(fetchAPYRequest())
        .put(fetchAPYStart())
        .put({
          type: COVERAGE_POOL_FETCH_APY_ERROR,
          payload: { error: mockedError.message },
        })
        .hasFinalState({
          ...coveragePoolInitialData,
          apyError: mockedError.message,
        })
        .run()
    })
  })

  describe("Fetch cov pool data watcher", () => {
    const balanceOf = Token.fromTokenUnit("100")
    const totalSupply = Token.fromTokenUnit("1000")
    const shareOfPool = 0.5
    const estimatedKeepBalance = Token.fromTokenUnit("50")
    const estimatedRewards = Token.fromTokenUnit("10")
    const address = "0x0"

    it("should fetch apy data correctly", () => {
      return expectSaga(watchFetchCovPoolData)
        .withReducer(coveragePoolReducer)
        .provide([
          [call(Keep.coveragePoolV1.covBalanceOf, address), balanceOf],
          [call(Keep.coveragePoolV1.covTotalSupply), totalSupply],
          [
            call(Keep.coveragePoolV1.shareOfPool, totalSupply, balanceOf),
            shareOfPool,
          ],
          [
            call(
              Keep.coveragePoolV1.estimatedCollateralTokenBalance,
              shareOfPool
            ),
            estimatedKeepBalance,
          ],
          [
            call(Keep.coveragePoolV1.estimatedRewards, address, shareOfPool),
            estimatedRewards,
          ],
        ])
        .dispatch(fetchCovPoolDataRequest(address))
        .put(fetchCovPoolDataStart())
        .put(
          fetchCovPoolDataSuccess({
            shareOfPool,
            covBalance: balanceOf,
            covTotalSupply: totalSupply,
            estimatedRewards,
            estimatedKeepBalance,
          })
        )
        .hasFinalState({
          ...coveragePoolInitialData,
          shareOfPool,
          covBalance: balanceOf,
          covTotalSupply: totalSupply,
          estimatedRewards,
          estimatedKeepBalance,
        })
        .run()
    })

    it("should log error if function has failed", () => {
      const mockedError = new Error("Fake error")

      return expectSaga(watchFetchCovPoolData)
        .withReducer(coveragePoolReducer)
        .provide([
          [
            call(Keep.coveragePoolV1.covBalanceOf, address),
            throwError(mockedError),
          ],
        ])
        .dispatch(fetchCovPoolDataRequest(address))
        .put(fetchCovPoolDataStart())
        .put({
          type: COVERAGE_POOL_FETCH_COV_POOL_DATA_ERROR,
          payload: { error: mockedError.message },
        })
        .hasFinalState({
          ...coveragePoolInitialData,
          error: mockedError.message,
        })
        .run()
    })
  })

  describe("Subscribe to cov token transfer event", () => {
    it("should udpate data correctly if the `Transfer` event has been emitted", () => {
      const address = "0x086813525A7dC7dafFf015Cdf03896Fd276eab60"
      const initialCovTotalSupply = Token.fromTokenUnit(100).toString()
      const initialCovBalance = Token.fromTokenUnit(30).toString()
      const transferEventData = {
        from: ZERO_ADDRESS,
        to: address,
        value: KEEP.fromTokenUnit("300").toString(),
      }
      const mockedEvent = {
        returnValues: transferEventData,
      }

      const initialState = {
        ...coveragePoolInitialData,
        covTotalSupply: initialCovTotalSupply,
        covBalance: initialCovBalance,
      }

      const updatedCovBalance = add(
        initialCovBalance,
        transferEventData.value
      ).toString()
      const updatedCovTotalSupply = add(
        initialCovTotalSupply,
        transferEventData.value
      ).toString()
      const updatedShareOfPool = 0.8
      const estimatedKeepBalance = KEEP.fromTokenUnit(350).toString()
      const estimatedRewards = KEEP.fromTokenUnit(35).toString()
      const updatedTvl = KEEP.fromTokenUnit(10000).toString()
      const keepInUSD = new BigNumber(0.25)
      const updatedAPY = 0.5
      const tvlInUSD = new BigNumber(keepInUSD)
        .multipliedBy(KEEP.toTokenUnit(updatedTvl))
        .toFormat(2)

      return expectSaga(subscribeToCovTokenTransferEvent)
        .withReducer(coveragePoolReducer, initialState.coveragePool)
        .withState(initialState)
        .provide([
          [select(selectors.getCoveragePool), initialState],
          [select(selectors.getUserAddress), address],
          [
            matchers.call.fn(Keep.coveragePoolV1.shareOfPool),
            updatedShareOfPool,
          ],
          [
            matchers.call.fn(
              Keep.coveragePoolV1.estimatedCollateralTokenBalance
            ),
            estimatedKeepBalance,
          ],
          [
            matchers.call.fn(Keep.coveragePoolV1.estimatedRewards),
            estimatedRewards,
          ],
          [matchers.call.fn(Keep.coveragePoolV1.totalValueLocked), updatedTvl],
          [
            matchers.call.fn(
              Keep.coveragePoolV1.exchangeService.getKeepTokenPriceInUSD
            ),
            keepInUSD,
          ],
          [matchers.call.fn(Keep.coveragePoolV1.apy), updatedAPY],
        ])
        .dispatch({
          type: COVERAGE_POOL_COV_TOKEN_TRANSFER_EVENT_EMITTED,
          payload: { event: mockedEvent },
        })
        .put(
          covTokenUpdated({
            covBalance: updatedCovBalance,
            covTotalSupply: updatedCovTotalSupply,
            shareOfPool: updatedShareOfPool,
            estimatedKeepBalance,
            estimatedRewards,
            totalValueLocked: updatedTvl,
            totalValueLockedInUSD: tvlInUSD,
            apy: updatedAPY,
          })
        )
        .hasFinalState({
          ...initialState,
          covBalance: updatedCovBalance,
          covTotalSupply: updatedCovTotalSupply,
          shareOfPool: updatedShareOfPool,
          estimatedKeepBalance,
          estimatedRewards,
          totalValueLocked: updatedTvl,
          totalValueLockedInUSD: tvlInUSD,
          apy: updatedAPY,
        })
        .run()
    })
  })
})