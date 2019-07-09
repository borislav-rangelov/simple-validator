# simple-validator

Example usage:

```javascript
 
const { checks, requestValidator } = require('simple-validator')

 let schema = {
     username: checks().isString()
         .required({ msg: 'Username is required.' })
         .regex({ pattern: /^[a-z0-9]*$/i, msg: 'Username must be alpha-numeric.' }),
     email: checks().isString()
         .required({ msg: 'Email is required.' })
         .email({ msg: 'Email is invalid.' })
         .func({
             fnc: (ctx, value, field, next) =>
                 // check in db
                 new Promise((res, rej) => setTimeout(() => res(next(true)), 1000)),
             msg: 'Email failed check in db.'
         }),
     password: checks().isString()
         .required({ msg: 'Password is required.' })
         .password({ req: ['upper', 'lower', 'number', 'special'], msg: '' }),
     repeatPassword: checks().isString()
         .required({ msg: 'Password is required.' })
         .sameAs({ path: '$/password', msg: 'Repeat password not same as password.' }),
 };

 let reqValidator = requestValidator(schema, 
     (req, res, next, ctx) => console.log('Success'),
     (req, res, next, errors, ctx) => console.log('Failed:\n', errors)
 );

 console.log('Checking with invalid body...');

 reqValidator({ body: {
     username: '',
     email: 'invalid',
     password: 'Aa#abcdavcd',
     repeatPassword: 'Aa1#abcd'
 } }, {});

 console.log('Checking with valid body...');

 reqValidator({ body: {
     username: 'abcd',
     email: 'abcd@mail.bg',
     password: 'Aa1#abcd',
     repeatPassword: 'Aa1#abcd'
 } }, {});
```