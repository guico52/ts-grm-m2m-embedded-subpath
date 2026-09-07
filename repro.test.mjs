// 最小复现：#1 m2m 集合子视图取 embedded 子路径 → DTO 构造崩溃
//
// 场景：Book.authors = prop.m2m(Author)，Author.name 是 embedded（firstName + lastName）。
//       dto.view 里 `c.authors.with(c => [c.id, c.name.lastName])` —— 集合子视图内取
//       embedded 子路径（lastName）。
//
// 预期（缺陷存在时）：查询执行期抛
//   TypeError: Cannot read properties of undefined (reading 'toFields')
//
// 对照组（规避写法）：取**整个** embedded（`c.name`）或标量 → 正常查询。
//
// 适用版本：@ts-grm/core@0.0.12（npm 发布版）复现；
//           本地主分支 ~/code/source/ts-grm（HEAD c7bbc06，2026-09-07 实测）仍未修复。
import { test } from "node:test";
import assert from "node:assert/strict";
import { model, prop, dto, spi } from "@ts-grm/core";
import { PostgresDriver, newSqlClient } from "@ts-grm/sql";

function toSnake(name) {
    return name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}
const naming = {
    tableName: (entity) => toSnake(entity.name),
    sequenceName: (entity) => toSnake(entity.name) + "_id_seq",
    columnName: (prop) => toSnake(prop.name),
    middleTableName: (prop) => toSnake(prop.declaringEntity.name) + "_" + toSnake(prop.targetEntity.name) + "_mapping",
    middleTableThisRefColumnName: (prop) => toSnake(prop.declaringEntity.name) + "_" + toSnake(prop.thisKeyProp.name),
    middleTableTargetRefColumnName: (prop) => toSnake(prop.targetEntity.name) + "_" + toSnake(prop.targetKeyProp.name),
};

// 假连接池：缺陷在 DTO 构造期（执行查询前）即崩溃，无需真库
const fakePool = { connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) };
function makeClient(models) {
    return newSqlClient(new PostgresDriver(fakePool), {
        strategy: naming,
        entityManager: { entities: async () => models.map((m) => spi.Entity.of(m)) },
    });
}

const Author = model("Author", "id", class {
    id = prop.i64()
    name = prop.embedded({
        firstName: prop.str(50),
        lastName: prop.str(50),
    })
    books = prop.m2m(Book).mappedBy("authors")
});

const Book = model("Book", "id", class {
    id = prop.i64()
    name = prop.str(50)
    edition = prop.i32()
    price = prop.num(10, 2)
    authors = prop.m2m(Author).joinTable({
        name: "book_author_mapping",
        joinThisColumns: ["book_id"],
        joinTargetColumns: ["author_id"],
    })
});

test("缺陷：m2m 集合子视图取 embedded 子路径（c.name.lastName）→ DTO 构造崩溃", async () => {
    // 崩溃点随版本略有差异：0.0.12 在 dto.view 构造期即崩；主分支在查询执行期崩。
    // 把两段都包进断言，两个版本都能捕获同一条错误消息。
    const client = makeClient([Author, Book]);
    await client.createSchema();
    await assert.rejects(
        async () => {
            const BookView = dto.view(Book, (c) => [
                c.$allScalars,
                c.authors.with((a) => [a.id, a.name.lastName]), // ← embedded 子路径
            ]);
            await client.createQuery(Book, (q, book) => q.select(book.fetch(BookView))).fetchList();
        },
        /Cannot read properties of undefined \(reading 'toFields'\)/,
    );
});

test("对照组：集合子视图取整个 embedded（c.name）→ 正常执行", async () => {
    const BookView = dto.view(Book, (c) => [
        c.$allScalars,
        c.authors.with((a) => [a.id, a.name]), // 规避写法：取整个 embedded
    ]);
    const client = makeClient([Author, Book]);
    await client.createSchema();
    const rows = await client.createQuery(Book, (q, book) => q.select(book.fetch(BookView))).fetchList();
    assert.ok(Array.isArray(rows));
});

test("对照组：集合子视图取标量（a.id）→ 正常执行", async () => {
    const BookView = dto.view(Book, (c) => [
        c.$allScalars,
        c.authors.with((a) => [a.id]),
    ]);
    const client = makeClient([Author, Book]);
    await client.createSchema();
    const rows = await client.createQuery(Book, (q, book) => q.select(book.fetch(BookView))).fetchList();
    assert.ok(Array.isArray(rows));
});