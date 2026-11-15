import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatHomeGreeting,
  homeGreeting,
  homeHourBucket,
  pickHomeGreetingPhrase,
  type HomeGreetingInput,
} from '../homeGreeting'

const base: HomeGreetingInput = {
  hour: 10,
  firstName: 'Sam',
  trainedToday: false,
  inProgress: false,
  isRestDay: false,
  nextDay: 'push',
  dateKey: '2026-08-15',
}

describe('homeHourBucket', () => {
  it('splits local hours into greeting windows', () => {
    assert.equal(homeHourBucket(0), 'graveyard')
    assert.equal(homeHourBucket(4), 'graveyard')
    assert.equal(homeHourBucket(5), 'early')
    assert.equal(homeHourBucket(7), 'early')
    assert.equal(homeHourBucket(8), 'morning')
    assert.equal(homeHourBucket(11), 'morning')
    assert.equal(homeHourBucket(12), 'afternoon')
    assert.equal(homeHourBucket(16), 'afternoon')
    assert.equal(homeHourBucket(17), 'evening')
    assert.equal(homeHourBucket(20), 'evening')
    assert.equal(homeHourBucket(21), 'late')
    assert.equal(homeHourBucket(23), 'late')
  })
})

describe('formatHomeGreeting', () => {
  it('matches the original "Let\'s get after it, Name." shape', () => {
    assert.equal(formatHomeGreeting("Let's get after it", 'Sam'), "Let's get after it, Sam.")
  })

  it('tucks the name in before a trailing question mark', () => {
    assert.equal(formatHomeGreeting('Evening session?', 'Sam'), 'Evening session, Sam?')
  })

  it('tucks the name in before a trailing period', () => {
    assert.equal(
      formatHomeGreeting("You're good. Sleep.", 'Sam'),
      "You're good. Sleep, Sam.",
    )
  })
})

describe('pickHomeGreetingPhrase', () => {
  it('open session beats rest, trained, and time of day', () => {
    const phrase = pickHomeGreetingPhrase({
      ...base,
      hour: 6,
      inProgress: true,
      trainedToday: true,
      isRestDay: true,
      nextDay: 'legs',
    })
    assert.ok(
      [
        'Unfinished business',
        "Let's finish this",
        "Mid-workout, don't bail",
        'Finish what you started',
      ].includes(phrase),
    )
  })

  it('trained beats rest and does not tell them the bar misses them', () => {
    assert.ok(
      ['Session in the books', 'Consistency pays out', 'Another one in the bank'].includes(
        pickHomeGreetingPhrase({ ...base, hour: 14, trainedToday: true, isRestDay: true }),
      ),
    )
  })

  it('late + already trained is the sleep line', () => {
    const late = [
      "You're good. Sleep.",
      'Good work. Go to bed.',
      'Recovery starts now',
      'Logged. Now rest.',
      'Rest is part of the program',
    ]
    assert.ok(late.includes(pickHomeGreetingPhrase({ ...base, hour: 22, trainedToday: true })))
    assert.ok(late.includes(pickHomeGreetingPhrase({ ...base, hour: 2, trainedToday: true })))
  })

  it('rest day when they have not trained', () => {
    const phrase = pickHomeGreetingPhrase({ ...base, hour: 10, isRestDay: true })
    assert.ok(
      ['Official rest day', 'Chill. You earned it', 'Recovery is training'].includes(phrase),
    )
  })

  it('past midnight and still empty is the 3am club pool', () => {
    const phrase = pickHomeGreetingPhrase({ ...base, hour: 3, nextDay: 'legs' })
    assert.ok(
      [
        "3am club, let's go",
        "Nobody's up but us",
        'Night shift',
        'Only the committed are awake',
      ].includes(phrase),
    )
  })

  it('late and still empty stays in the night pool', () => {
    const phrase = pickHomeGreetingPhrase({ ...base, hour: 22, nextDay: 'legs' })
    assert.ok(
      phrase === "Gym doesn't sleep"
        || phrase === "Late, but we're here"
        || phrase === "Night's not closed"
        || phrase === 'Night owls lift too',
    )
  })

  it('evening and still empty is Evening session?', () => {
    assert.ok(
      ['Evening session?', "Evening's wide open"].includes(
        pickHomeGreetingPhrase({ ...base, hour: 18 }),
      ),
    )
  })

  it('legs overlay wins morning/afternoon when they have not trained', () => {
    const legs = ["Fresh legs, let's go", "Leg day. Don't skip it.", 'Legs are calling']
    assert.ok(legs.includes(pickHomeGreetingPhrase({ ...base, hour: 9, nextDay: 'legs' })))
    assert.ok(legs.includes(pickHomeGreetingPhrase({ ...base, hour: 14, nextDay: 'LEGS' })))
  })

  it('early morning is World\'s still asleep', () => {
    assert.ok(
      [
        "World's still asleep",
        "Sun's not up, we are",
        'Get the work in before the day gets you',
      ].includes(pickHomeGreetingPhrase({ ...base, hour: 6 })),
    )
  })

  it('morning pool includes Rise and shine / grind / get after it', () => {
    const phrase = pickHomeGreetingPhrase({ ...base, hour: 9 })
    assert.ok(
      phrase === 'Rise and grind'
        || phrase === 'Rise and shine'
        || phrase === "Let's get after it"
        || phrase === 'Morning reps hit different',
    )
  })

  it('afternoon pool is the daytime / default mix', () => {
    const phrase = pickHomeGreetingPhrase({ ...base, hour: 14 })
    assert.ok(
      [
        'Still plenty of day',
        "Let's get after it",
        'Plot twist: you lift',
        'The bar misses you',
        "Workout's waiting",
        "Afternoon's still yours",
      ].includes(phrase),
    )
  })

  it('is stable for the same date + situation', () => {
    const a = pickHomeGreetingPhrase({ ...base, hour: 14, dateKey: '2026-08-15' })
    const b = pickHomeGreetingPhrase({ ...base, hour: 14, dateKey: '2026-08-15' })
    assert.equal(a, b)
  })
})

describe('homeGreeting', () => {
  it('returns the ready-to-render heading', () => {
    assert.ok(
      ['Evening session, Sam?', "Evening's wide open, Sam."].includes(
        homeGreeting({ ...base, hour: 18, firstName: 'Sam' }),
      ),
    )
  })
})
