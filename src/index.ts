declare const module: { exports?: { [name: string]: any } };
module.exports = {};

interface Context {
    root: any,
    current: any,
    path: string,
    errors: { [name: string]: Error }
    [name: string]: any
}

interface Error {
    field: string,
    msg: string
}

interface Validator {
    (ctx: Context, value: any, field: string, next: () => any): any;
}

interface Validators {
    func(options: FuncOptions): Validators,
    required(options: ValidatorOptions): Validators,
    isString(options: ValidatorOptions): Validators,
    regex(options: RegexOptions): Validators,
    email(options: ValidatorOptions): Validators,
    password(options: PasswordOptions): Validators,
    sameAs(options: SameAsOptions): Validators
    custom(name: string, opts: any): Validators
}

const _customValidators: { [name: string]: (opts: any) => Validator } = {};

interface ValidatorOptions {
    msg?: string;
}

interface FuncOptions extends ValidatorOptions {
    fnc: Validator
}

interface RegexOptions extends ValidatorOptions {
    pattern: RegExp
}

interface PasswordOptions extends ValidatorOptions {
    req?: string[]
    minLength?: number
    maxLength?: number
}

interface SameAsOptions extends ValidatorOptions {
    path: string
}

interface ValidatorResult extends Promise<boolean | Error> {

}

interface ValidationResult {
    success: boolean
    errors?: { [name: string]: Error }
}

interface OnRequestSuccess {
    (request, response, next: () => void, context: Context): void
}

interface OnRequestError {
    (request, response, next: () => void, result: ValidationResult, context: Context): void
}

class validatorsImpl implements Validators {

    private validators: Validator[] = [];
    private customValidators: { [name: string]: (opts: any) => Validator };

    constructor(customValidators: { [name: string]: (opts: any) => Validator }) {
        this.customValidators = customValidators;
    }

    private validator(func: Validator) {
        this.validators.push(func);
    }

    validate(ctx: Context, value: any, field: string): ValidatorResult {
        if (this.validators.length === 0)
            return Promise.resolve(true);

        return new Promise((res, rej) => {
            let i = 0, l = this.validators.length;

            let nextValidatorCall = () => {
                if (i >= l) {
                    return true;
                }
                return this.validators[i++](ctx, value, field, nextValidatorCall);
            };

            let result: any;

            try {
                result = nextValidatorCall();
            } catch (err) {
                result = err;
            }

            valResultToPromise(result, field)
                .then(res)
                .catch(rej);
        });
    }

    func(options: FuncOptions): Validators {
        this.validator((ctx, value, field, next) => {
            options = options || <FuncOptions>{};
            reqOption(options.fnc, 'validation function is required.')
            // TODO handle options.msg
            return valResultToPromise(
                options.fnc(ctx, value, field, next),
                ctx.path
            );
        });
        return this;
    }

    required(options: ValidatorOptions): Validators {
        options = options || {};
        this.validator((ctx, value, field, next) => {
            if (value === null || value === undefined || value === '') {
                return options.msg || ctx.path + ' is required';
            }
            return next();
        });
        return this;
    }

    isString(options: ValidatorOptions): Validators {
        options = options || {};
        this.validator(function (ctx, value, field, next) {
            if (value === undefined || value === null || typeof value === 'string') {
                return next();
            }
            return options.msg || ctx.path + ' must be a string.';
        });
        return this;
    }

    regex(options: RegexOptions): Validators {
        options = options || <RegexOptions>{};
        reqOption(options.pattern, 'pattern is required.');
        this.validator(function (ctx, value, field, next) {
            return options.pattern.test(value) ?
                next() :
                options.msg || ctx.path + ' is invalid.';
        });
        return this;
    }

    email(options: ValidatorOptions): Validators {
        options = options || {};
        return this.regex({
            // src: http://emailregex.com/
            pattern: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/i,
            msg: options.msg
        });
    }

    password(options: PasswordOptions): Validators {
        options = options || {};
        options.req = options.req || ['upper', 'lower', 'number', 'special'];

        if (!options.req.forEach) {
            throw new Error('req must be a list');
        }

        const charsets = [];
        const minLength = options.minLength && options.minLength > 0 ? options.minLength : 8;
        const maxLength = options.maxLength && options.maxLength > 0 ? options.maxLength : 32;

        options.req.forEach(val => {
            if (val === 'upper') {
                charsets.push(/[A-Z]+/);
            } else if (val === 'lower') {
                charsets.push(/[a-z]+/);
            } else if (val === 'number') {
                charsets.push(/[0-9]+/);
            } else if (val === 'special') {
                charsets.push(/[ !"#\$%&'\(\)\*\+,-\.\/:;<=>\?@\[\\\]\^_`{\|}~]+/);
            } else {
                charsets.push(new RegExp(val, "i"));
            }
        });

        this.validator((ctx, value, field, next) => {

            if (typeof value !== 'string') {
                return options.msg || ctx.path + ' is invalid.'
            }

            if (value.length < minLength || value.length > maxLength) {
                return options.msg || ctx.path + ' is invalid.';
            }

            for (let i = 0; i < charsets.length; i++) {
                let pattern = charsets[i];

                if (!pattern.test(value)) {
                    return options.msg || ctx.path + ' is invalid.';
                }
            }

            return next();
        });
        return this;
    }

    sameAs(options: SameAsOptions): Validators {
        options = options || <SameAsOptions>{};
        reqOption(options.path, 'validation field is required.');

        let pathString = options.path;
        const startWithRoot = pathString.startsWith('$/');

        if (startWithRoot) {
            pathString = pathString.substr(2);
        }

        const path = pathString.split('/');

        this.validator(function (ctx, value, field, next) {
            let current = startWithRoot ? ctx.root : ctx.current;

            for (let i = 0; i < path.length; i++) {
                let p = path[i];

                if (current[p] !== undefined && current[p] !== null) {

                    current = current[p];

                } else {

                    current = null;
                    break;
                }
            }

            if ((value === undefined || value === null) && current === null) {
                return next();
            }

            if (value === current) {
                return next();
            }

            return options.msg || ctx.path + ' is not same as ' + options.path;
        });
        return this;
    }

    custom(name: string, options: any): Validators {
        let validator = this.customValidators[name];
        if (!validator) {
            console.trace(`No custom validator found with name ${name}.`);
            return this;
        }
        this.validator(validator(options));
        return this;
    }
}

module.exports.checks = function checks(): Validators {
    return new validatorsImpl(_customValidators);
}

module.exports.registerCustomValidator =  function registerCustomValidator(name: string, ctor: (options: any) => Validator) {
    _customValidators[name] = ctor;
}

module.exports.newObjectValidator = function newObjectValidator(schema: any):
    (obj: any) => Promise<boolean | ValidationResult> {

    if (!schema) {
        throw new Error('Schema is required')
    }

    return value => {
        if (!value) {
            throw new Error('Value is required')
        }
        const context: Context = {
            root: value,
            current: value,
            path: '',
            errors: {}
        };
        return _validateObject(context, schema);
    };
}

module.exports.newRequestBodyValidator = function newRequestBodyValidator(schema, onSuccess: OnRequestSuccess, onError: OnRequestError) {
    if (!schema) {
        throw new Error('Schema is required')
    }
    if (!onSuccess) {
        onSuccess = function (req, res, next, ctx) {
            req.body = ctx.root;
            next();
        };
    }
    if (!onError) {
        onError = function (req, res, next, result, ctx) {
            res.status(400).json(result.errors);
        };
    }
    return (request, response, next) => {

        if (!request.body) {
            request.body = {};
        }

        const context = {
            root: request.body,
            current: request.body,
            path: '',
            errors: {},
            request: request,
            response: response
        };

        _validateObject(context, schema)
            .then(() => onSuccess(request, response, next, context))
            .catch((errors) => onError(request, response, next, errors, context));
    };
}

function _validateObject(ctx: Context, schema): Promise<ValidationResult> {

    const validations: ValidatorResult[] = [];

    let keys = Object.keys(ctx.current);
    for (let field in schema) {
        
        let keyIndex = keys.indexOf(field);
        if (keyIndex > -1) {
            keys.splice(keyIndex, 1);
        }

        let schemaVal = schema[field];
        if (!schemaVal) continue;

        if (schemaVal instanceof validatorsImpl) {
            let context = shallowCopy(ctx);

            context.path = context.path + field;

            let result;
            try {
                result = schemaVal.validate(context, context.current[field], field);
            } catch (err) {
                result = err;
            }

            validations.push(valResultToPromise(result, context.path));
            continue;
        }

        // to be implemented for nested objects and lists
        throw new Error('Not implemented');
    }
    
    if (keys.length) {
        // found keys not in schema. removing from object
        keys.forEach(key => delete ctx.current[key]);
    }

    return new Promise((res, rej) => {
        let i = 0, l = validations.length;
        let errors: { [name: string]: Error } = {};
        validations.forEach(v => {
            v.then(() => {
                i++;
                if (i >= l) {
                    if (Object.keys(errors).length) {
                        rej({
                            success: false,
                            errors: errors
                        });
                    } else {
                        res({
                            success: true
                        });
                    }
                }
            }).catch((err: Error) => {
                i++;
                errors[err.field] = err;
                if (i >= l) rej({
                    success: false,
                    errors: errors
                });
            })
        });
    });
}

function reqOption(option, msg) {
    if (!option) throw new Error(msg);
}

function shallowCopy<T extends {}>(obj1: T, obj2?: T) {
    let result: T = <T>{};
    for (let field in obj1) {
        result[field] = obj1[field];
    }
    if (obj2) {
        for (let field in obj2) {
            result[field] = obj2[field];
        }
    }
    return result;
}

function valResultToPromise(valResult: any, field: string): ValidatorResult {
    if (valResult instanceof Promise) {
        // TODO recursive mapping of results until a better type is resolved
        return valResult;
    }
    if (valResult instanceof Error) {
        return Promise.reject({
            field: field,
            msg: valResult.message
        });
    }

    switch (typeof valResult) {
        case 'boolean':
            return valResult ?
                Promise.resolve(true) :
                Promise.reject({
                    field: field,
                    msg: ''
                });
        case 'string':
            return Promise.reject({
                field: field,
                msg: valResult
            });
        case 'object': // to be implemented to handle error messages and error codes
        default:
            throw new Error('Not implemented for type ' + (typeof valResult));
    }
}
