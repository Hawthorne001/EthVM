import {Injectable} from '@nestjs/common'
import {InjectEntityManager} from '@nestjs/typeorm'
import {Between, EntityManager, FindOneOptions, In, LessThanOrEqual} from 'typeorm'
import {AggregateBlockMetric, BlockMetricField, TimeBucket} from '@app/graphql/schema'
import {unitOfTime} from 'moment'
import BigNumber from 'bignumber.js';
import {BlockMetricsTraceEntity} from '@app/orm/entities/block-metrics-trace.entity';
import moment = require('moment');
import {BlockHeaderEntity} from '@app/orm/entities/block-header.entity';
import {BlockMetricsHeaderEntity} from '@app/orm/entities/block-metrics-header.entity';
import {BlockMetricEntity} from '@app/orm/entities/block-metric.entity';

const HEADER_FIELDS = [
  BlockMetricField.AVG_BLOCK_TIME,
  BlockMetricField.AVG_DIFFICULTY,
  BlockMetricField.AVG_TOTAL_DIFFICULTY,
  BlockMetricField.AVG_NUM_UNCLES,
  BlockMetricField.AVG_GAS_LIMIT,
  BlockMetricField.AVG_GAS_PRICE,
]

const TX_TRACE_FIELDS = [
  BlockMetricField.AVG_NUM_TXS,
  BlockMetricField.AVG_NUM_SUCCESSFUL_TXS,
  BlockMetricField.AVG_NUM_FAILED_TXS,
  BlockMetricField.AVG_NUM_INTERNAL_TXS,
  BlockMetricField.AVG_TX_FEES,
  BlockMetricField.AVG_TOTAL_TX_FEES,
]

@Injectable()
export class BlockMetricsService {

  constructor(@InjectEntityManager() private readonly entityManager: EntityManager) {
  }

  async findBlockMetricsTraces(blockHashes: string [], maxTimestamp: Date, minTimestamp: Date, txn?: EntityManager): Promise<BlockMetricsTraceEntity[]> {
    txn = txn || this.entityManager
    return txn
      .find(BlockMetricsTraceEntity, {
        where: {
          hash: In(blockHashes),
          timestamp: Between(minTimestamp.toISOString(), maxTimestamp.toISOString())
        },
        cache: true,
      })
  }

  async findBlockMetricsTracesByHash(hash: string, maxTimestamp: Date, minTimestamp: Date, cache: boolean = true, blockNumber: BigNumber): Promise<BlockMetricsTraceEntity | undefined> {
    return this.entityManager
      .findOne(BlockMetricsTraceEntity, {
        where: { hash, number: LessThanOrEqual(blockNumber), timestamp: Between(minTimestamp.toISOString, maxTimestamp.toISOString) },
        cache,
      })
  }

  async findBlockMetrics(offset: number, limit: number, blockNumber: BigNumber): Promise<[BlockMetricEntity[], number]> {

    return this.entityManager
      .transaction('READ COMMITTED', async (txn): Promise<[BlockMetricEntity[], number]> => {

        // much cheaper to do the count against canonical block header table instead of using the
        // usual count mechanism

        const {number, timestamp} = await txn
          .findOne(BlockHeaderEntity, {
            select: ['number', 'timestamp'],
            where: {
              number: LessThanOrEqual(blockNumber),
            },
            orderBy: {
              number: 'DESC',
            },
            cache: true,
          } as FindOneOptions)

        const entities = await txn.find(BlockMetricEntity, {
          where: {
            number: LessThanOrEqual(blockNumber),
            timestamp: LessThanOrEqual(timestamp.toISOString())
          },
          order: { number: 'DESC' },
          skip: offset,
          take: limit,
          cache: true,
        })

        return [entities, number + 1]
      })

  }

  private estimateDatapoints(start: Date = new Date(), end: Date = new Date('2000-01-01T00:00:00.000Z'), bucket: TimeBucket): number {

    const startMoment = moment(start)
    const endMoment = moment(end)

    let timeUnit: unitOfTime.Diff
    switch (bucket) {
      case TimeBucket.ONE_HOUR:
        timeUnit = 'hours'
        break
      case TimeBucket.ONE_DAY:
        timeUnit = 'days'
        break
      case TimeBucket.ONE_WEEK:
        timeUnit = 'weeks'
        break
      case TimeBucket.ONE_MONTH:
        timeUnit = 'months'
        break
      case TimeBucket.ONE_YEAR:
        timeUnit = 'years'
        break
      default:
        throw new Error(`Unexpected time bucket: ${bucket}`)
    }

    return startMoment.diff(endMoment, timeUnit)
  }

  async timeseries(
    bucket: TimeBucket,
    field: BlockMetricField,
    blockNumber: BigNumber,
    start?: Date,
    end: Date = new Date('2000-01-01T00:00:00.000Z'),
  ): Promise<AggregateBlockMetric[]> {

    // If start or end is set, round to nearest minute in order to take advantage of caching similar queries
    // Start is set to end of minute as it is later in time, and vice versa, to be inclusive of time range
    start = start ? moment(start).endOf('minute').toDate() : undefined
    end = moment(end).startOf('minute').toDate()

    const datapoints = this.estimateDatapoints(start, end, bucket)

    if (datapoints > 10000) {
      throw new Error('Estimated datapoints exceeds 10,000. Try refining your date range or adjusting your time bucket')
    }

    const select: string[] = []
    let queryBuilder

    switch (bucket) {
      case TimeBucket.ONE_HOUR:
        select.push('time_bucket(\'1 hour\', bm.timestamp) as time')
        break
      case TimeBucket.ONE_DAY:
        select.push('time_bucket(\'1 day\', bm.timestamp) as time')
        break
      case TimeBucket.ONE_WEEK:
        select.push('time_bucket(\'1 week\', bm.timestamp) as time')
        break
      case TimeBucket.ONE_MONTH:
        select.push('time_bucket(\'1 month\', bm.timestamp) as time')
        break
      case TimeBucket.ONE_YEAR:
        select.push('time_bucket(\'1 year\', bm.timestamp) as time')
        break
      default:
        throw new Error(`Unexpected bucket value: ${bucket}`)
    }

    switch (field) {
      case BlockMetricField.AVG_BLOCK_TIME:
        select.push('round(avg(block_time)) as avg_block_time')
        break
      case BlockMetricField.AVG_NUM_UNCLES:
        select.push('round(avg(num_uncles)) as avg_num_uncles')
        break
      case BlockMetricField.AVG_DIFFICULTY:
        select.push('round(avg(difficulty)) as avg_difficulty')
        break
      case BlockMetricField.AVG_TOTAL_DIFFICULTY:
        select.push('round(avg(total_difficulty)) as avg_total_difficulty')
        break
      case BlockMetricField.AVG_GAS_LIMIT:
        select.push('round(avg(avg_gas_limit)) as avg_gas_limit')
        break
      case BlockMetricField.AVG_GAS_PRICE:
        select.push('round(avg(avg_gas_price)) as avg_gas_price')
        break
      case BlockMetricField.AVG_NUM_TXS:
        select.push('round(avg(total_txs)) as avg_num_txs')
        break
      case BlockMetricField.AVG_NUM_SUCCESSFUL_TXS:
        select.push('round(avg(num_successful_txs)) as avg_num_successful_txs')
        break
      case BlockMetricField.AVG_NUM_FAILED_TXS:
        select.push('round(avg(num_failed_txs)) as avg_num_failed_txs')
        break
      case BlockMetricField.AVG_NUM_INTERNAL_TXS:
        select.push('round(avg(num_internal_txs)) as avg_num_internal_txs')
        break
      case BlockMetricField.AVG_TX_FEES:
        select.push('round(avg(avg_tx_fees)) as avg_tx_fees')
        break
      case BlockMetricField.AVG_TOTAL_TX_FEES:
        select.push('round(avg(total_tx_fees)) as avg_total_tx_fees')
        break
      default:
        throw new Error(`Unexpected metric: ${field}`)
    }

    // Create query builder for correct entity depending on field param

    if (HEADER_FIELDS.indexOf(field) > -1) {
      queryBuilder = this.entityManager.createQueryBuilder(BlockMetricsHeaderEntity, 'bm')
    } else if (TX_TRACE_FIELDS.indexOf(field) > -1) {
      queryBuilder = this.entityManager.createQueryBuilder(BlockMetricsTraceEntity, 'bm')
    } else {
      throw new Error(`Unexpected metric: ${field}`)
    }

    // Set where clause if start and/or end params are set

    queryBuilder
      .select(select)
      .where('bm.number <= :blockNumber')

    if (start) {
      queryBuilder.andWhere('bm.timestamp between :end and :start', {start, end})
    } else {
      queryBuilder.andWhere('bm.timestamp > :end', {end})
    }

    const items = await queryBuilder
      .groupBy('time')
      .orderBy({time: 'DESC'})
      .setParameters({start, end, blockNumber: blockNumber.toNumber()})
      .cache(true)
      .getRawMany()

    // Map items to AggregateBlockMetric shape before returning

    return items.map(item => {

      return {
        timestamp: item.time,
        avgBlockTime: item.avg_block_time,
        avgNumUncles: item.avg_num_uncles,
        avgDifficulty: item.avg_difficulty,
        avgTotalDifficulty: item.avg_total_difficulty,
        avgGasLimit: item.avg_gas_limit,
        avgGasPrice: item.avg_gas_price,
        avgNumTxs: item.avg_num_txs,
        avgNumSuccessfulTxs: item.avg_num_successful_txs,
        avgNumFailedTxs: item.avg_num_failed_txs,
        avgNumInternalTxs: item.avg_num_internal_txs,
        avgTxFees: item.avg_tx_fees,
        avgTotalTxFees: item.avg_total_tx_fees,
      } as AggregateBlockMetric

    })
  }

}
