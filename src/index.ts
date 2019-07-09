declare const module: { exports?: { [name: string]: any } };
module.exports = {};

interface Context {
    root: any,
    current: any,
    path: string,
    errors: { [name: string]: ValError }
    [name: string]: any
}

interface ValError {
    field: string,
    msg: string
}

interface Validator<T> {
    (ctx: Context, value: any, field: string, next: () => any): T;
}

const _customValidators: { [name: string]: (opts: any) => Validator<any> } = {};

interface ValidatorOptions {
    msg?: string;
}

interface StringOptions extends ValidatorOptions {
    trim?: boolean,
    case?: string,
    other?: Validator<string>
}

interface FuncOptions extends ValidatorOptions {
    fnc: Validator<any>
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

interface ValidatorResult extends Promise<boolean | ValError> {

}

interface ValidationResult {
    success: boolean
    errors?: { [name: string]: ValError }
}

interface OnRequestSuccess {
    (request, response, next: () => void, result: ValidationResult, context: Context): void
}

interface OnRequestError {
    (request, response, next: () => void, error: any, context: Context): void
}

interface ValidatorConfig {
    trimBody?: boolean
}

class Validators {

    private validators: Validator<any>[] = [];
    private customValidators: { [name: string]: (opts: any) => Validator<any> };

    constructor(customValidators: { [name: string]: (opts: any) => Validator<any> }) {
        this.customValidators = customValidators;
    }

    private validator(func: Validator<any>) {
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
                return this.validators[i++](ctx, ctx.current[field], field, nextValidatorCall);
            };

            let result: any;

            try {
                result = nextValidatorCall();
            } catch (err) {
                rej(err);
            }

            valResultToPromise(result, field)
                .then(res)
                .catch(rej);
        });
    }

    func(options: FuncOptions): Validators {
        options = options || <FuncOptions>{};
        reqOption(options.fnc, 'validation option fcn is required.')
        this.validator((ctx, value, field, next) => {
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

    isString(options: StringOptions): Validators {
        options = options || {};
        this.validator(function (ctx, value: string, field, next) {
            if (value === undefined || value === null || typeof value === 'string') {
                if (!value) return next();
                if (options.trim) {
                    value = value.trim();
                }
                if (options.case) {
                    if (options.case === 'upper') {
                        value = value.toUpperCase();
                    } else if (options.case === 'lower') {
                        value = value.toLowerCase();
                    }
                }
                ctx.current[field] = value;
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
    return new Validators(_customValidators);
}

module.exports.registerCustomValidator =  function registerCustomValidator(name: string, ctor: (options: any) => Validator<any>) {
    _customValidators[name] = ctor;
}

module.exports.newObjectValidator = function newObjectValidator(schema: any, config?: ValidatorConfig):
    (obj: any) => Promise<boolean | ValidationResult> {

    if (!schema) {
        throw new Error('Schema is required')
    }

    if (!config) {
        config = {
            trimBody: true
        }
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
        return _validateObject(context, schema, config);
    };
}

module.exports.newRequestBodyValidator = function newRequestBodyValidator(
        schema: any, onSuccess?: OnRequestSuccess, onError?: OnRequestError, config?: ValidatorConfig) {

    if (!schema) {
        throw new Error('Schema is required')
    }
    if (!onSuccess) {
        onSuccess = function (req, res, next, result, ctx) {
            if (result.success) {
                req.body = ctx.root;
                next();
                return;
            }
            res.status(400).json(result.errors);
        };
    }
    if (!onError) {
        onError = function (req, res, next, err, ctx) {
            console.error('Something went wrong: ' + err);
            res.status(500);
        };
    }
    if (!config) {
        config = {
            trimBody: true
        }
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

        _validateObject(context, schema, config)
            .then((result) => {
                onSuccess(request, response, next, result, context);
                
            })
            .catch((err) => onError(request, response, next, err, context));
    };
}

function _validateObject(ctx: Context, schema, config: ValidatorConfig): Promise<ValidationResult> {

    const validations: ValidatorResult[] = [];
    
    let keys = Object.keys(ctx.current);
    for (let field in schema) {
        
        let keyIndex = keys.indexOf(field);
        if (keyIndex > -1) {
            keys.splice(keyIndex, 1);
        }

        let schemaVal = schema[field];
        if (!schemaVal) continue;

        if (schemaVal instanceof Validators) {
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
    
    if (config.trimBody && keys.length) {
        // found keys not in schema. removing from object
        keys.forEach(key => delete ctx.current[key]);
    }

    return new Promise((res, rej) => {
        
        let i = 0, l = validations.length;
        let errors: { [name: string]: ValError } = {};

        validations.forEach(v => {
            v.then((val) => {
                
                i++;
                
                if (val !== true) {
                    errors[(<ValError>val).field] = <ValError>val;
                }

                if (i >= l) {
                    if (Object.keys(errors).length) {
                        res({
                            success: false,
                            errors: errors
                        });
                    } else {
                        res({
                            success: true
                        });
                    }
                }
            }).catch(rej);
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
        return Promise.reject(valResult);
    }

    switch (typeof valResult) {
        case 'boolean':
            return valResult ?
                Promise.resolve(true) :
                Promise.resolve({
                    field: field,
                    msg: ''
                });
        case 'string':
            return Promise.resolve({
                field: field,
                msg: valResult
            });
        case 'object': // to be implemented to handle error messages and error codes
        default:
            throw new Error('Not implemented for type ' + (typeof valResult));
    }
}
