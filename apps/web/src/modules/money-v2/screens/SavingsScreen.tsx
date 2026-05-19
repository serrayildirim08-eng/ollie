/**
 * money-v2 · SavingsScreen — Level 3 detail (money-savings.html)
 *
 * One thing: one saved-toward goal. The amount on a soft horizon line —
 * same horizon grammar as safe-to-spend. No charts.
 *
 * Real data: `savingsVM` over `finance.goals` (the first goal) using the
 * live `savingsGoalProgress` pure fn. "add to savings" appends a real
 * contribution through useMoneyActions.
 */
import { useMemo, useState } from 'react';
import { Screen, HeroNumber, AmberButton, IconStar, IconPlus, v2 } from '../v2';
import { useFinanceSlices } from '../useFinanceSlices';
import { useMoneyActions } from '../useMoneyActions';
import { savingsVM, fmtMoney } from '../selectors';
import { AddSheet } from './AddSheet';

export interface SavingsScreenProps {
  now: number;
  onBack: () => void;
  onFind: () => void;
  onSafe: () => void;
}

export function SavingsScreen({ now, onBack, onFind, onSafe }: SavingsScreenProps) {
  void onBack;
  const slices = useFinanceSlices();
  const actions = useMoneyActions(now);
  const [sheet, setSheet] = useState(false);

  const savings = useMemo(
    () => savingsVM(slices.goals, slices.records, now),
    [slices.goals, slices.records, now],
  );

  return (
    <Screen
      label="savings"
      glyph={<IconStar stroke={v2.accent} />}
      onFind={onFind}
      onSafe={onSafe}
      centered
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          maxWidth: 320,
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        {savings.haveGoal ? (
          <>
            <div style={{ fontSize: 13, color: v2.mute, fontWeight: 500, letterSpacing: '0.02em' }}>
              saving toward
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 25,
                fontWeight: 400,
                color: v2.ink,
                letterSpacing: '-0.015em',
              }}
            >
              {savings.goalName}
            </div>
            <div style={{ marginTop: 18 }}>
              <HeroNumber
                lead=""
                value={fmtMoney(savings.saved)}
                size={72}
                horizon={savings.fill}
                caption={
                  <>
                    <span style={{ display: 'block', marginBottom: 8 }}>
                      of ${fmtMoney(savings.target)}
                    </span>
                    {savings.paceLabel ?? 'add a little when you can'}
                  </>
                }
              />
            </div>
            <AmberButton
              icon={<IconPlus size={17} />}
              onClick={() => setSheet(true)}
              style={{ marginTop: 44 }}
            >
              add to savings
            </AmberButton>
          </>
        ) : (
          <>
            <div
              style={{
                fontSize: 17,
                color: v2.mute,
                fontWeight: 400,
                textAlign: 'center',
                lineHeight: 1.5,
                maxWidth: 240,
              }}
            >
              name something to save toward — a trip, a buffer, anything.
            </div>
            <AmberButton
              icon={<IconPlus size={17} />}
              onClick={() => setSheet(true)}
              style={{ marginTop: 36 }}
            >
              start a savings goal
            </AmberButton>
          </>
        )}
      </div>

      {sheet && (
        <AddSheet
          title={savings.haveGoal ? 'add to savings' : 'a savings goal'}
          nameLabel={savings.haveGoal ? savings.goalName : 'what are you saving for'}
          onCancel={() => setSheet(false)}
          onSave={({ name, amount }) => {
            actions.addToSavings(amount, savings.haveGoal ? undefined : name);
            setSheet(false);
          }}
        />
      )}
    </Screen>
  );
}
