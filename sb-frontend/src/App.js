import React, { useEffect, useMemo, useState } from 'react';
import groups from './data/groups';
import './App.css';

const storageKey = 'sb-dutchpay-v1';

const createId = () => `id-${Math.random().toString(16).slice(2)}`;

const createExpense = (payer) => ({
    id: createId(),
    label: '',
    amount: '',
    payer: payer || '',
});

const createRound = (order, owner) => {
    const first = createExpense(owner || '정산계좌');
    return {
        id: createId(),
        title: `상세내역 ${order}`,
        participants: owner ? [{ name: owner, weight: 1 }] : [],
        expenses: [first],
    };
};

const formatMoney = (value) => {
    const num = Math.round(value || 0);
    return num.toLocaleString('ko-KR');
};

const buildLine = (char, length) => char.repeat(length);

const formatDefaultTitle = (date = new Date()) => {
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const pad = (value) => value.toString().padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(
        date.getDate()
    )}(${dayNames[date.getDay()]})`;
};

const defaultOwner = '건';

function App() {
    const [title, setTitle] = useState(() => formatDefaultTitle());
    const [accountHolder, setAccountHolder] = useState(defaultOwner);
    const [accountInfo, setAccountInfo] = useState('카카오뱅크 3333104179876');
    const [rounds, setRounds] = useState(() => [createRound(1, defaultOwner)]);
    const [activeRoundId, setActiveRoundId] = useState(
        () => rounds[0]?.id || ''
    );
    const [participantDrafts, setParticipantDrafts] = useState({});
    const [couplePairs, setCouplePairs] = useState([]);
    const [groupModal, setGroupModal] = useState({
        open: false,
        activeKey: groups[0]?.key || '',
        selectedByGroup: {},
    });
    const [coupleDraft, setCoupleDraft] = useState([]);
    const [copyNotice, setCopyNotice] = useState('');

    useEffect(() => {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed.title) setTitle(parsed.title);
                if (parsed.accountHolder) setAccountHolder(parsed.accountHolder);
                if (parsed.accountInfo) setAccountInfo(parsed.accountInfo);
                if (parsed.rounds?.length) {
                    setRounds(parsed.rounds);
                    setActiveRoundId(parsed.activeRoundId || parsed.rounds[0].id);
                }
                if (parsed.couplePairs) setCouplePairs(parsed.couplePairs);
            } catch (err) {
                console.error('저장된 데이터를 불러오지 못했습니다.', err);
            }
        }
    }, []);

    useEffect(() => {
        const payload = {
            title,
            accountHolder,
            accountInfo,
            rounds,
            activeRoundId,
            couplePairs,
        };
        localStorage.setItem(storageKey, JSON.stringify(payload));
    }, [title, accountHolder, accountInfo, rounds, activeRoundId, couplePairs]);

    useEffect(() => {
        if (!copyNotice) return;
        const timer = setTimeout(() => setCopyNotice(''), 2200);
        return () => clearTimeout(timer);
    }, [copyNotice]);

    const allNames = useMemo(() => {
        const names = new Set();
        names.add(accountHolder);
        rounds.forEach((round) => {
            round.participants.forEach((p) => names.add(p.name));
            round.expenses.forEach((e) => e.payer && names.add(e.payer));
        });
        return Array.from(names).filter(Boolean);
    }, [rounds, accountHolder]);

    const roundSummaries = useMemo(() => {
        return rounds.map((round) => {
            const totalWeight = round.participants.reduce(
                (sum, p) => sum + (parseFloat(p.weight) || 0),
                0
            );
            const totalAmount = round.expenses.reduce(
                (sum, e) => sum + (Number(e.amount) || 0),
                0
            );
            return {
                id: round.id,
                totalWeight,
                totalAmount,
                perHead:
                    totalWeight > 0 ? Math.round(totalAmount / totalWeight) : undefined,
            };
        });
    }, [rounds]);

    const settlement = useMemo(() => {
        const ledger = {};
        const ensure = (name) => {
            if (!name) return;
            if (!ledger[name]) {
                ledger[name] = { owed: 0, paid: 0 };
            }
        };

        rounds.forEach((round) => {
            const totalWeight = round.participants.reduce(
                (sum, p) => sum + (parseFloat(p.weight) || 0),
                0
            );

            round.participants.forEach((p) => ensure(p.name));

            round.expenses.forEach((expense) => {
                const amount = Number(expense.amount);
                if (!amount) return;
                const payer = expense.payer || accountHolder;
                ensure(payer);

                const share = totalWeight > 0 ? amount / totalWeight : 0;
                round.participants.forEach((p) => {
                    const weight = parseFloat(p.weight) || 0;
                    ledger[p.name].owed += share * weight;
                });

                ledger[payer].paid += amount;
            });
        });

        const balances = Object.entries(ledger).map(([name, value]) => {
            const net = Math.round(value.owed - value.paid);
            return {
                name,
                owed: Math.round(value.owed),
                paid: Math.round(value.paid),
                net,
            };
        });

        const coupleSummary = couplePairs.map((pair) => {
            const net = pair.members.reduce((sum, member) => {
                const found = balances.find((b) => b.name === member);
                return sum + (found?.net || 0);
            }, 0);
            return {
                label: pair.label || pair.members.join(' + '),
                net,
            };
        });

        const totalSpent = rounds.reduce(
            (sum, round) =>
                sum +
                round.expenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0),
            0
        );

        return { balances, coupleSummary, totalSpent };
    }, [rounds, couplePairs, accountHolder]);

    const clipboardText = useMemo(() => {
        const sortedBalances = [...settlement.balances].sort(
            (a, b) => b.net - a.net
        );

        const expenseFlat = rounds
            .flatMap((round) => round.expenses)
            .filter((e) => Number(e.amount));

        const roundBlocks = rounds.map((round, idx) => {
            const summary = roundSummaries.find((r) => r.id === round.id);
            const perHead = summary?.perHead || 0;
            const totalAmount = summary?.totalAmount || 0;
            const totalWeight = summary?.totalWeight || 0;
            const peopleLabel = Number.isInteger(totalWeight)
                ? `${totalWeight}명`
                : `${totalWeight.toFixed(1)}명`;
            const top = `┌${buildLine('─', 20)}┐`;
            const bottom = `└${buildLine('─', 20)}┘`;
            const participantLine =
                round.participants.length > 0
                    ? round.participants
                        .map(
                            (p) =>
                                `${p.name}${p.weight && p.weight !== 1 ? `(${p.weight}명)` : ''}`
                        )
                        .join(', ')
                    : '참여자 없음';

            const expenseLines =
                round.expenses.length > 0
                    ? round.expenses.map((e) => {
                        const amount = Number(e.amount) || 0;
                        const payer = e.payer ? ` · 결제: ${e.payer}` : '';
                        return `│ • ${e.label || '항목'} ${formatMoney(amount)}원${payer}`;
                    })
                    : ['│ • 영수증 없음'];

            const shareLines =
                round.participants.length > 0
                    ? round.participants.map((p) => {
                        const share = Math.round(perHead * (parseFloat(p.weight) || 0));
                        return `│   ${p.name}: ${formatMoney(share)}원`;
                    })
                    : ['│   부담 없음'];

            return [
                top,
                `│ [상세 ${idx + 1}] ${round.title || '제목 없음'}`,
                `│ 인원(${peopleLabel}): ${participantLine}`,
                '│ 영수증:',
                ...expenseLines,
                `│ 1인 기준: ${formatMoney(perHead)}원 (총액 ${formatMoney(
                    totalAmount
                )}원)`,
                '│ 부담 금액:',
                ...shareLines,
                bottom,
            ].join('\n');
        });

        const lines = [
            `제목: ${title}`,
            `정산 계좌: ${accountInfo} 독고건 or 카카오페이`,
            '',
            '[개인 정산]',
            ...sortedBalances.map(
                (b) =>
                    `${b.name}: ${formatMoney(Math.abs(b.net))}원 ${
                        b.net > 0
                            ? '입금'
                            : b.net < 0
                            ? '환급'
                            : '정산 완료'
                    } (부담 ${formatMoney(b.owed)} · 결제 ${formatMoney(b.paid)})`
            ),
        ];

        if (settlement.coupleSummary.length) {
            lines.push('', '[커플/합산]');
            settlement.coupleSummary.forEach((c) => {
                lines.push(
                    `${c.label}: ${formatMoney(Math.abs(c.net))}원 ${
                        c.net > 0 ? '입금' : c.net < 0 ? '환급' : '정산 완료'
                    }`
                );
            });
        }

        lines.push(
            '',
            '[지출 상세]',
            `• 총 지출: ${formatMoney(settlement.totalSpent)}원`,
            ...expenseFlat.map((e) => {
                const payer = e.payer ? ` · 결제: ${e.payer}` : '';
                return `• ${e.label || '항목'} ${formatMoney(
                    Number(e.amount) || 0
                )}원${payer}`;
            }),
            '',
            '[차수별 상세]',
            ...roundBlocks
        );

        return lines.join('\n');
    }, [title, accountHolder, accountInfo, settlement, rounds, roundSummaries]);

    const aggregatedSelection = useMemo(() => {
        const seen = new Set();
        const result = [];
        Object.values(groupModal.selectedByGroup).forEach((members = []) => {
            members.forEach((name) => {
                if (name && !seen.has(name)) {
                    seen.add(name);
                    result.push(name);
                }
            });
        });
        return result;
    }, [groupModal.selectedByGroup]);

    const handleRoundUpdate = (roundId, updater) => {
        setRounds((prev) =>
            prev.map((round) => {
                if (round.id !== roundId) return round;
                return typeof updater === 'function' ? updater(round) : updater;
            })
        );
    };

    const handleAddParticipant = (roundId, name, weight = 1) => {
        const trimmed = name?.trim();
        if (!trimmed) return;
        handleRoundUpdate(roundId, (round) => {
            if (round.participants.some((p) => p.name === trimmed)) return round;
            return {
                ...round,
                participants: [...round.participants, { name: trimmed, weight }],
            };
        });
        setParticipantDrafts((prev) => ({ ...prev, [roundId]: '' }));
    };

    const handleWeightChange = (roundId, name, weight) => {
        handleRoundUpdate(roundId, (round) => ({
            ...round,
            participants: round.participants.map((p) =>
                p.name === name ? { ...p, weight } : p
            ),
        }));
    };

    const handleRemoveParticipant = (roundId, name) => {
        handleRoundUpdate(roundId, (round) => ({
            ...round,
            participants: round.participants.filter((p) => p.name !== name),
        }));
    };

    const handleExpenseChange = (roundId, expenseId, key, value) => {
        handleRoundUpdate(roundId, (round) => ({
            ...round,
            expenses: round.expenses.map((exp) =>
                exp.id === expenseId ? { ...exp, [key]: value } : exp
            ),
        }));
    };

    const handleAddExpense = (roundId) => {
        handleRoundUpdate(roundId, (round) => ({
            ...round,
            expenses: [...round.expenses, createExpense(accountHolder)],
        }));
    };

    const handleRemoveExpense = (roundId, expenseId) => {
        handleRoundUpdate(roundId, (round) => ({
            ...round,
            expenses:
                round.expenses.length === 1
                    ? [createExpense(accountHolder)]
                    : round.expenses.filter((exp) => exp.id !== expenseId),
        }));
    };

    const handleAddRound = (mode = 'new') => {
        const nextOrder = rounds.length + 1;
        const newRound =
            mode === 'copy' && rounds.length
                ? {
                    ...createRound(nextOrder, ''),
                    participants: rounds[rounds.length - 1].participants.map((p) => ({
                        ...p,
                    })),
                }
                : {
                    ...createRound(nextOrder, accountHolder),
                    participants: accountHolder
                        ? [{ name: accountHolder, weight: 1 }]
                        : [],
                };

        setRounds((prev) => [...prev, newRound]);
        setActiveRoundId(newRound.id);
    };

    const handleRemoveRound = (roundId) => {
        if (rounds.length === 1) {
            const reset = createRound(1, accountHolder);
            setRounds([reset]);
            setActiveRoundId(reset.id);
            return;
        }
        const filtered = rounds.filter((r) => r.id !== roundId);
        setRounds(filtered);
        if (activeRoundId === roundId && filtered[0]) {
            setActiveRoundId(filtered[filtered.length - 1].id);
        }
    };

    const getGroupMembers = (key) =>
        groups.find((g) => g.key === key)?.members || [];

    const handleGroupSelect = (name) => {
        setGroupModal((prev) => {
            const activeKey = prev.activeKey;
            const current = prev.selectedByGroup[activeKey] || [];
            const exists = current.includes(name);
            const next = exists
                ? current.filter((n) => n !== name)
                : [...current, name];

            return {
                ...prev,
                selectedByGroup: {
                    ...prev.selectedByGroup,
                    [activeKey]: next,
                },
            };
        });
    };

    const selectAllGroupMembers = () => {
        setGroupModal((prev) => {
            const activeKey = prev.activeKey;
            const members = getGroupMembers(activeKey);
            return {
                ...prev,
                selectedByGroup: {
                    ...prev.selectedByGroup,
                    [activeKey]: [...members],
                },
            };
        });
    };

    const clearActiveGroupSelection = () => {
        setGroupModal((prev) => ({
            ...prev,
            selectedByGroup: {
                ...prev.selectedByGroup,
                [prev.activeKey]: [],
            },
        }));
    };

    const clearAllGroupSelection = () => {
        setGroupModal((prev) => ({
            ...prev,
            selectedByGroup: {},
        }));
    };

    const removeNameEverywhere = (name) => {
        setGroupModal((prev) => {
            const next = {};
            Object.entries(prev.selectedByGroup).forEach(([key, members = []]) => {
                const filtered = members.filter((member) => member !== name);
                if (filtered.length) {
                    next[key] = filtered;
                }
            });
            return { ...prev, selectedByGroup: next };
        });
    };

    const applyGroupSelection = () => {
        const targetRound =
            rounds.find((r) => r.id === activeRoundId) || rounds[rounds.length - 1];
        aggregatedSelection.forEach((name) =>
            handleAddParticipant(targetRound.id, name, 1)
        );
        setGroupModal((prev) => ({
            ...prev,
            open: false,
            selectedByGroup: {},
        }));
    };

    const toggleCoupleDraft = (name) => {
        setCoupleDraft((prev) => {
            const exists = prev.includes(name);
            if (exists) return prev.filter((n) => n !== name);
            if (prev.length >= 2) return [prev[1], name];
            return [...prev, name];
        });
    };

    const addCouplePair = () => {
        if (coupleDraft.length < 2) return;
        const label = coupleDraft.join(' + ');
        setCouplePairs((prev) => [...prev, { label, members: coupleDraft }]);
        setCoupleDraft([]);
    };

    const removeCouplePair = (label) => {
        setCouplePairs((prev) => prev.filter((p) => p.label !== label));
    };

    const copySummary = async () => {
        try {
            await navigator.clipboard.writeText(clipboardText);
            setCopyNotice('정산 요약을 클립보드에 복사했어요');
        } catch (err) {
            setCopyNotice('클립보드 복사에 실패했어요');
            console.error(err);
        }
    };

    const activeGroupSelection =
        groupModal.selectedByGroup[groupModal.activeKey] || [];

    const activeRoundSummary = roundSummaries.find(
        (r) => r.id === activeRoundId
    );

    return (
        <div className="app-shell">
            <header className="hero">
                <div className="hero__title">
                    <p className="eyebrow">히스토리 기반 더치페이 메이커</p>
                    <input
                        className="title-input"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="모임 제목을 입력하세요"
                    />
                    <p className="subtitle">
                        차수별 참여 인원/가중치/결제자를 분리해서 입력하고, 커플·반값
                        규칙까지 한 번에 정산하세요.
                    </p>
                    <div className="hero__chips">
                        <span>인원수 기준 상세내역 분리</span>
                        <span>반값·가중치 반영</span>
                        <span>결제자 별도 처리</span>
                        <span>커플 합산</span>
                    </div>
                </div>
                <div className="meta-panel">
                    <div className="meta-field">
                        <label>정산 받을 사람</label>
                        <input
                            value={accountHolder}
                            onChange={(e) => setAccountHolder(e.target.value)}
                            placeholder="예: 건"
                        />
                    </div>
                    <div className="meta-field">
                        <label>계좌 정보</label>
                        <input
                            value={accountInfo}
                            onChange={(e) => setAccountInfo(e.target.value)}
                            placeholder="카카오뱅크 3333104179876 or 카카오페이"
                        />
                    </div>
                    <div className="meta-buttons">
                        <button onClick={() => handleAddRound('new')}>상세내역 추가</button>
                        <button className="ghost" onClick={() => handleAddRound('copy')}>
                            직전 멤버 복사
                        </button>
                        <button className="ghost" onClick={() => setGroupModal((prev) => ({
                            ...prev,
                            open: true,
                            selected: [],
                        }))}>
                            그룹에서 불러오기
                        </button>
                    </div>
                    {activeRoundSummary && (
                        <div className="meta-note">
                            <strong>현재 상세내역 예상 1인 정산</strong>
                            <span>
                                {formatMoney(activeRoundSummary.perHead || 0)}원 (총{' '}
                                {formatMoney(activeRoundSummary.totalAmount)}원 / 가중치 합{' '}
                                {activeRoundSummary.totalWeight})
                            </span>
                        </div>
                    )}
                </div>
                <div className="meta-panel tips">
                    <div className="tips__title">히스토리 분석 메모</div>
                    <ul>
                        <li>
                            참여 인원이 바뀌면 새 상세내역으로 끊어 계산했어요(1차/2차, 중간
                            합류).
                        </li>
                        <li>
                            집 초대·늦은 합류는 0.5배 등 가중치로 처리했어요(예: 16,216원).
                        </li>
                        <li>
                            커플/부부는 합산해 한 명만 송금하도록 별도 금액을 남겼어요.
                        </li>
                        <li>
                            친구가 결제한 영수증은 해당 친구 몫에서 차감(결제자 필드)했어요.
                        </li>
                    </ul>
                </div>
            </header>

            <main className="grid">
                <section className="rounds">
                    <div className="section-title">
                        <div>
                            <h2>상세내역 & 입력</h2>
                            <p>차수별로 참여자·가중치·영수증·결제자를 기록하세요.</p>
                        </div>
                        <div className="section-actions">
                            <button onClick={() => handleAddRound('new')}>+ 새 상세</button>
                            <button onClick={() => handleAddRound('copy')}>직전 복사</button>
                        </div>
                    </div>
                    <div className="round-list">
                        {rounds.map((round) => {
                            const summary = roundSummaries.find((s) => s.id === round.id);
                            return (
                                <div
                                    key={round.id}
                                    className={`round-card ${activeRoundId === round.id ? 'is-active' : ''
                                        }`}
                                    onClick={() => setActiveRoundId(round.id)}
                                >
                                    <div className="round-card__header">
                                        <input
                                            value={round.title}
                                            onChange={(e) =>
                                                handleRoundUpdate(round.id, {
                                                    ...round,
                                                    title: e.target.value,
                                                })
                                            }
                                        />
                                        <div className="round-card__meta">
                                            {summary && (
                                                <span>
                                                    합계 {formatMoney(summary.totalAmount)}원 / 1인{' '}
                                                    {formatMoney(summary.perHead || 0)}원
                                                </span>
                                            )}
                                            <button
                                                className="icon-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleRemoveRound(round.id);
                                                }}
                                                title="상세내역 삭제"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </div>

                                    <div className="round-card__body">
                                        <div className="panel">
                                            <div className="panel__title">참여자 & 가중치</div>
                                            <div className="participants">
                                                {round.participants.map((p) => (
                                                    <div key={p.name} className="participant">
                                                        <span className="name">{p.name}</span>
                                                        <div className="weight">
                                                            {/* <label>가중치</label> */}
                                                            <input
                                                                type="number"
                                                                value={p.weight}
                                                                onChange={(e) =>
                                                                    handleWeightChange(
                                                                        round.id,
                                                                        p.name,
                                                                        Number(e.target.value) || 0
                                                                    )
                                                                }
                                                            />
                                                            <div className="weight-shortcuts">
                                                                <button
                                                                    onClick={() =>
                                                                        handleWeightChange(round.id, p.name, 0.5)
                                                                    }
                                                                >
                                                                    0.5
                                                                </button>
                                                                <button
                                                                    onClick={() =>
                                                                        handleWeightChange(round.id, p.name, 1)
                                                                    }
                                                                >
                                                                    1
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <button
                                                            className="icon-btn"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleRemoveParticipant(round.id, p.name);
                                                            }}
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ))}
                                                <div className="participant-add">
                                                    <input
                                                        value={participantDrafts[round.id] || ''}
                                                        onChange={(e) =>
                                                            setParticipantDrafts((prev) => ({
                                                                ...prev,
                                                                [round.id]: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="이름 입력 후 Enter"
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                handleAddParticipant(
                                                                    round.id,
                                                                    participantDrafts[round.id],
                                                                    1
                                                                );
                                                            }
                                                        }}
                                                    />
                                                    <button
                                                        onClick={() =>
                                                            handleAddParticipant(
                                                                round.id,
                                                                participantDrafts[round.id],
                                                                1
                                                            )
                                                        }
                                                    >
                                                        추가
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="panel">
                                            <div className="panel__title">영수증 & 결제자</div>
                                            <div className="expense-head">
                                                <span>상호/메모</span>
                                                <span>금액</span>
                                                <span>결제자</span>
                                                <span />
                                            </div>
                                            <div className="expenses">
                                                {round.expenses.map((expense) => (
                                                    <div key={expense.id} className="expense">
                                                        <input
                                                            className="wide"
                                                            placeholder="상호/메모"
                                                            value={expense.label}
                                                            onChange={(e) =>
                                                                handleExpenseChange(
                                                                    round.id,
                                                                    expense.id,
                                                                    'label',
                                                                    e.target.value
                                                                )
                                                            }
                                                        />
                                                        <input
                                                            type="number"
                                                            placeholder="금액"
                                                            value={expense.amount}
                                                            onChange={(e) =>
                                                                handleExpenseChange(
                                                                    round.id,
                                                                    expense.id,
                                                                    'amount',
                                                                    e.target.value
                                                                )
                                                            }
                                                        />
                                                        <input
                                                            list="payer-options"
                                                            placeholder="결제자(없으면 본인)"
                                                            value={expense.payer}
                                                            onChange={(e) =>
                                                                handleExpenseChange(
                                                                    round.id,
                                                                    expense.id,
                                                                    'payer',
                                                                    e.target.value
                                                                )
                                                            }
                                                        />
                                                        <button
                                                            className="icon-btn"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleRemoveExpense(round.id, expense.id);
                                                            }}
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                            <button
                                                className="ghost full"
                                                onClick={() => handleAddExpense(round.id)}
                                            >
                                                + 항목 추가
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section className="summary">
                    <div className="section-title">
                        <div>
                            <h2>정산 결과</h2>
                            <p>가중치·결제자·커플 합산을 반영한 최종 금액입니다.</p>
                        </div>
                        <div className="section-actions">
                            <button onClick={copySummary}>요약 복사</button>
                        </div>
                    </div>

                    <div className="summary-grid">
                        <div className="summary-card">
                            <div className="summary-card__header">
                                <h3>개인별</h3>
                                <span className="pill">
                                    총 지출 {formatMoney(settlement.totalSpent)}원
                                </span>
                            </div>
                            <div className="balances">
                                {[...settlement.balances]
                                    .sort((a, b) => b.net - a.net)
                                    .map((b) => (
                                        <div key={b.name} className="balance-row">
                                            <div>
                                                <strong>{b.name}</strong>
                                                <small>
                                                    부담 {formatMoney(b.owed)}원 · 결제{' '}
                                                    {formatMoney(b.paid)}원
                                                </small>
                                            </div>
                                            <span
                                                className={`amount ${b.net > 0 ? 'plus' : b.net < 0 ? 'minus' : ''
                                                    }`}
                                            >
                                                {formatMoney(Math.abs(b.net))}원{' '}
                                                {b.net > 0 ? '입금' : b.net < 0 ? '환급' : '완료'}
                                            </span>
                                        </div>
                                    ))}
                            </div>
                        </div>

                        <div className="summary-card">
                            <div className="summary-card__header">
                                <h3>커플/합산</h3>
                                <span className="pill ghost">필요한 경우만 추가</span>
                            </div>
                            <div className="couple-builder">
                                <div className="chip-grid">
                                    {allNames.map((name) => (
                                        <button
                                            key={name}
                                            className={`chip ${coupleDraft.includes(name) ? 'selected' : ''
                                                }`}
                                            onClick={() => toggleCoupleDraft(name)}
                                        >
                                            {name}
                                        </button>
                                    ))}
                                </div>
                                <div className="couple-actions">
                                    <span>
                                        선택: {coupleDraft.join(' + ') || '없음'} (2명 선택)
                                    </span>
                                    <button onClick={addCouplePair}>커플 추가</button>
                                </div>
                            </div>

                            <div className="balances">
                                {settlement.coupleSummary.length === 0 && (
                                    <p className="muted">커플/합산 대상이 없습니다.</p>
                                )}
                                {settlement.coupleSummary.map((c) => (
                                    <div key={c.label} className="balance-row">
                                        <div>
                                            <strong>{c.label}</strong>
                                            <small>합산 기준</small>
                                        </div>
                                        <div className="couple-actions">
                                            <span
                                                className={`amount ${c.net > 0 ? 'plus' : c.net < 0 ? 'minus' : ''
                                                    }`}
                                            >
                                                {formatMoney(Math.abs(c.net))}원{' '}
                                                {c.net > 0 ? '입금' : c.net < 0 ? '환급' : '완료'}
                                            </span>
                                            <button
                                                className="icon-btn"
                                                onClick={() => removeCouplePair(c.label)}
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="summary-card">
                            <div className="summary-card__header">
                                <h3>클립보드용 문구</h3>
                                <span className="pill ghost">차수별 상세까지 포함</span>
                            </div>
                            <div className="clipboard-preview">
                                <pre>{clipboardText}</pre>
                            </div>
                            <button className="full" onClick={copySummary}>
                                복사하기
                            </button>
                        </div>
                    </div>
                </section>
            </main>

            <datalist id="payer-options">
                {allNames.map((name) => (
                    <option key={name} value={name} />
                ))}
            </datalist>

            {groupModal.open && (
                <div className="modal-backdrop" onClick={() => setGroupModal((prev) => ({ ...prev, open: false }))}>
                    <div
                        className="modal"
                        onClick={(e) => {
                            e.stopPropagation();
                        }}
                    >
                        <div className="modal__header">
                            <h3>그룹에서 참여자 추가</h3>
                            <button
                                className="icon-btn"
                                onClick={() =>
                                    setGroupModal((prev) => ({ ...prev, open: false }))
                                }
                            >
                                ✕
                            </button>
                        </div>
                        <div className="modal__tabs">
                            {groups.map((g) => (
                                <button
                                    key={g.key}
                                    className={`tab ${groupModal.activeKey === g.key ? 'active' : ''
                                        }`}
                                    onClick={() =>
                                        setGroupModal((prev) => ({
                                            ...prev,
                                            activeKey: g.key,
                                        }))
                                    }
                                >
                                    {g.label}
                                </button>
                            ))}
                        </div>
                        <div className="modal__body">
                            <div className="modal__group-selection">
                                <div className="chip-grid">
                                    {getGroupMembers(groupModal.activeKey).map((name) => (
                                        <button
                                            key={name}
                                            className={`chip ${activeGroupSelection.includes(name) ? 'selected' : ''
                                                }`}
                                            onClick={() => handleGroupSelect(name)}
                                        >
                                            {name}
                                        </button>
                                    ))}
                                </div>
                                <div className="modal__group-selection__actions">
                                    <button className="ghost" onClick={selectAllGroupMembers}>
                                        전체 선택
                                    </button>
                                    <button
                                        className="ghost"
                                        onClick={clearActiveGroupSelection}
                                    >
                                        선택 해제
                                    </button>
                                </div>
                            </div>
                            <div className="modal__selected-list">
                                <div className="modal__selected-list__label">
                                    <div>
                                        <strong>선택된 인원</strong>
                                        <p className="muted small">
                                            다른 그룹을 이동해도 누적됩니다.
                                        </p>
                                    </div>
                                    <button
                                        className="ghost"
                                        onClick={clearAllGroupSelection}
                                    >
                                        모두 해제
                                    </button>
                                </div>
                                {aggregatedSelection.length ? (
                                    <div className="chip-grid">
                                        {aggregatedSelection.map((name) => (
                                            <button
                                                key={`selected-${name}`}
                                                className="chip selected"
                                                onClick={() => removeNameEverywhere(name)}
                                            >
                                                {name}
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="muted">선택된 인원이 없습니다.</p>
                                )}
                                <small className="muted">
                                    다시 눌러서 제거하거나 적용 후 유지됩니다.
                                </small>
                            </div>
                        </div>
                        <div className="modal__footer">
                            <span>
                                {aggregatedSelection.length
                                    ? `${aggregatedSelection.length}명 선택됨`
                                    : '이름을 클릭해 선택하세요'}
                            </span>
                            <div className="modal__actions">
                                <button onClick={applyGroupSelection}>추가하기</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {copyNotice && <div className="toast">{copyNotice}</div>}
        </div>
    );
}

export default App;
