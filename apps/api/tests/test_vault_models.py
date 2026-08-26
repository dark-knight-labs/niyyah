from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.vault import VaultBlockVote, VaultDay


@pytest.mark.asyncio
async def test_vault_day_and_block_vote_roundtrip():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with Session() as session:
        day = VaultDay(date=date(2026, 8, 23), mode="full", possible=21, total=2)
        session.add(day)
        await session.commit()
        await session.refresh(day)

        vote = VaultBlockVote(vault_day_id=day.id, block="soul", stars=2)
        session.add(vote)
        await session.commit()
        await session.refresh(vote)

        assert vote.id is not None
        assert vote.stars == 2

    await engine.dispose()


@pytest.mark.asyncio
async def test_vault_day_date_is_unique():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with Session() as session:
        session.add(VaultDay(date=date(2026, 8, 23), mode="full", possible=21, total=0))
        await session.commit()

        session.add(VaultDay(date=date(2026, 8, 23), mode="full", possible=21, total=5))
        with pytest.raises(IntegrityError):
            await session.commit()

    await engine.dispose()


@pytest.mark.asyncio
async def test_block_vote_unique_per_day():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with Session() as session:
        day = VaultDay(date=date(2026, 8, 23), mode="full", possible=21, total=0)
        session.add(day)
        await session.commit()
        await session.refresh(day)

        session.add(VaultBlockVote(vault_day_id=day.id, block="soul", stars=1))
        await session.commit()

        session.add(VaultBlockVote(vault_day_id=day.id, block="soul", stars=3))
        with pytest.raises(IntegrityError):
            await session.commit()

    await engine.dispose()
