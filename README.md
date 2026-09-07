# ts-grm-m2m-embedded-subpath：m2m 集合子视图取 embedded 子路径 → DTO 构造崩溃

复现 `@ts-grm/core@0.0.12`（npm 官方包）的发布缺陷：

- **场景**：实体 `Book.authors = prop.m2m(Author)`，`Author.name` 是 `embedded`
  （含 `firstName` / `lastName`），`dto.view` 里集合子视图取 embedded **子路径**：
  `c.authors.with(c => [c.id, c.name.lastName])`。
- **预期**：正常生成 DTO，查询返回作者的名/姓。
- **实际**：查询执行期抛 `TypeError: Cannot read properties of undefined (reading 'toFields')`。
- **规避**：集合子视图取**整个** embedded（`c.name`）或标量（`c.id`）即可——对照测试通过。

> 核对基准：本地主分支 `~/code/source/ts-grm`（HEAD `c7bbc06`，2026-09-07 实测）**仍未修复**，
> 崩溃现象与 0.0.12 完全一致。相关崩溃点在 `packages/core/src/impl/dto_context.ts`（`addMapping`
> 内 `mapping.toFields(this._downcastTo)`，m2m 集合元素映射为 undefined）。

## 运行

```bash
npm install   # 安装 @ts-grm/core@0.0.12 + @ts-grm/sql@0.0.12（官方 npm 原版，未打补丁）
npm test      # node --test repro.test.mjs：1 个缺陷用例 + 2 个对照组
```

预期：缺陷用例断言"崩溃被复现"，两个对照组正常执行 —— 全部通过即确认缺陷存在。

## 最小复现（核心片段）

```js
const Author = model("Author", "id", class {
    id = prop.i64()
    name = prop.embedded({ firstName: prop.str(50), lastName: prop.str(50) })
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

const BookView = dto.view(Book, (c) => [
    c.$allScalars,
    c.authors.with((a) => [a.id, a.name.lastName]),  // ← embedded 子路径
]);

await client.createQuery(Book, (q, book) => q.select(book.fetch(BookView))).fetchList();
// TypeError: Cannot read properties of undefined (reading 'toFields')
```

对照组：`c.authors.with(a => [a.id, a.name])`（整个 embedded）或 `[a.id]`（标量）→ 查询正常。

## 复现主分支（如需核对最新代码）

把 `package.json` 依赖改为本地主分支构建产物并先构建：

```bash
# 主分支 ~/code/source/ts-grm：cd packages/core && ../../node_modules/.bin/tsdown --dts
#                    cd packages/sql   && ../../node_modules/.bin/tsdown --dts
# 然后把 package.json 依赖换成：
#   "@ts-grm/core": "file:/绝对路径/source/ts-grm/packages/core",
#   "@ts-grm/sql":  "file:/绝对路径/source/ts-grm/packages/sql"
npm install && npm test
```

或直接把两个 dist 产物用 `npm pack`/`file:` 引用后重跑 `npm test`。

环境：Node >= 20（ESM）。