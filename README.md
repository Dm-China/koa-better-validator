### Installation
---
The library was inspired by the [validator.js](https://github.com/validatorjs/validator.js).

```javascript
$ npm i koa-better-validator -S
```
or
```javascript
$ yarn add koa-better-validator -S
```

### Usage
---
```javascript
const Koa = require('koa')
const { koaValidator, KoaValidatorException } = require('koa-better-validator')
const app = new Koa()

// catch exception
app.use(async (ctx, next) => {
  try {
    await next()
  } catch (e) {
    if(e instanceof KoaValidatorException) {
      ctx.body = {
        errMsg: e.errMsg || 'This is koa-better-validator catch errors'
      } 
    }
  } 
})

// customize you validator
app.use(koaValidator({
  customValidators: {
    isString (param) {
      return Object.prototype.toString.call(param) === '[object String]' ? param : false;
    }
    // other customValidators
}
}))

app.use(async (ctx, next) => {
  // The method check will automatically identify from body、params、query、header
  // ctx.query, ctx.params, ctx.request.body(if you have used a library like koa-bodyparser), headers
  ctx.check('name', 'the name length should be between 6 and 10 ').isLength({min: 6, max: 10})
  const { name } = await ctx.valid()
  console.log(name)
  await next()
})

app.listen(3000)
```

