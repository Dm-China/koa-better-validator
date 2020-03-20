"use strict";

const _ = require('lodash')
const validator = require('validator')

const toString = input => {
  if (typeof input === 'object' && input !== null && input.toString) {
    return input.toString();
  }

  if (input === null || typeof input === 'undefined' || Number.isNaN(input) && !input.length) {
    return '';
  }

  return `${input}`;
};


const additionalValidators = ['contains', 'equals', 'matches'];

const locate = (ctx, name) => {
  if (_.get(ctx.params, name)) {
    return 'params';
  }

  if (_.has(ctx.query, name)) {
    return 'query';
  }

  if (_.has(ctx.request.body, name)) {
    return 'body';
  }

  if (_.has(ctx.header, name)) {
    return 'header'
  }

  return undefined;
};

const formatParamOutput = param => {
  if (Array.isArray(param)) {
    return param.reduce((prev, curr) => {
      if (validator.isInt(`${curr}`)) {
        return `${prev}[${curr}]`;
      }

      if (prev) {
        return `${prev}.${curr}`;
      }

      return `${prev}${curr}`;
    });
  }

  return param;
};

const defaultErrorFormatter = (param, msg, value) => ({
  param,
  msg,
  value
});

class ValidatorChain {
  constructor(param, failMsg, ctx, location, {
    errorFormatter = defaultErrorFormatter,
    skipValidationOnFirstError = false
  }) {
    const context = location === 'body' ? ctx.request[location] : ctx[location];
    this.errorFormatter = errorFormatter;
    this.param = param;
    this.value = location ? _.get(context, param) : undefined;
    this.validationErrors = [];
    this.failMsg = failMsg;
    this.ctx = ctx;
    this.skipValidationOnFirstError = skipValidationOnFirstError;
    this.lastError = null; // used by withMessage to get the values of the last error

    return this;
  }

  notEmpty() {
    return this.isLength({
      min: 1
    });
  }

  len(...rest) {
    return this.isLength(...rest);
  }

  optional({
             checkFalsy = false
           } = {}) {
    if (checkFalsy) {
      if (!this.value) {
        this.skipValidating = true;
      }
    } else if (this.value === undefined) {
      this.skipValidating = true;
    }

    return this;
  }

  formatErrors(param, msg, value) {
    const formattedParam = formatParamOutput(param);
    return this.errorFormatter(formattedParam, msg, value);
  }
}

const validateSchema = (schema, ctx, loc, options) => {
  const locations = ['body', 'params', 'query', 'header'];
  let currentLoc = loc;
  Object.entries(schema).forEach(([fieldName, constrains]) => {
    if (Object.prototype.hasOwnProperty.call(constrains, 'in')) {
      if (locations.indexOf(constrains.in) !== -1) {
        currentLoc = constrains.in;
      } else {
        return;
      }
    }

    currentLoc = currentLoc === 'any' ? locate(ctx, fieldName) : currentLoc;
    const validatorChain = new ValidatorChain(fieldName, null, ctx, currentLoc, options);
    const paramErrorMessage = constrains.errorMessage;
    Object.entries(constrains).forEach(([methodName, methodOptions]) => {
      if (methodName === 'errorMessage') {
        return;
      }

      if (methodName === 'in') {
        currentLoc = loc;
        return;
      }

      validatorChain.failMsg = methodOptions.errorMessage || paramErrorMessage || 'Invalid param';
      validatorChain[methodName](...(methodOptions.options || []));
    });
  });
};

const makeValidator = (methodName, container) => function dynamicValidator(...rest) {
  if (this.skipValidating) {
    return this;
  }

  const ctx = container === validator ? undefined : this.ctx;
  const isValid = container[methodName](container === validator ? toString(this.value) : this.value, ...rest, ctx);
  const error = this.formatErrors(this.param, this.failMsg || 'Invalid value', this.value);

  if (!isValid) {
    this.validationErrors.push(error);

    this.ctx._validationErrors.push(error);

    this.lastError = {
      param: this.param,
      value: this.value,
      isAsync: false
    };

    if (this.skipValidationOnFirstError) {
      this.skipValidating = true;
    }
  } else {
    this.lastError = null;
  }

  return this;
};


_.forEach(validator, (method, methodName) => {
  if (methodName.match(/^is/) || _.includes(additionalValidators, methodName)) {
    ValidatorChain.prototype[methodName] = makeValidator(methodName, validator);
  }
});

// 自定义异常类，外部可捕获到特定异常
class KoaValidatorException extends Error {
  constructor(errors) {
    super();
    this.errMsg = errors
  }
}

const koaValidator = ({
                        customValidators = {},
                        ...options
                      } = {}) => {
  _.forEach(customValidators, (method, customValidatorName) => {
    ValidatorChain.prototype[customValidatorName] = makeValidator(customValidatorName, customValidators);
  });

  return async (ctx, next) => {
    const locations = ['body', 'params', 'query', 'headers'];
    ctx._validationErrors = [];
    ctx.valid = async mapped => {
      if (mapped && ctx._validationErrors.length > 0) {
        const errors = {};

        ctx._validationErrors.forEach(err => {
          errors[err.param] = err;
        });

        return errors;
      }
      let errors = ctx._validationErrors
      if (errors.length > 0) {
        errors = _.uniqWith(errors, _.isEqual);
        throw new KoaValidatorException(errors)
      } else {
        return _getParams(ctx);
      }
    };

    function _getParams(ctx) {
      const headerOwnParams = [
        'host',
        'connection',
        'origin',
        'user-agent',
        'accept-language',
        'accept',
        'content-type',
        'content-length',
        'accept-encoding'
      ];
      const headers = _delAttrInObj(ctx.request.header, headerOwnParams);
      return {
        ...ctx.query,
        ...ctx.params,
        ...ctx.request.body,
        ...headers
      };
    }

    // 删除对象上的属性，@param(attrs) 属性数组
    function _delAttrInObj(obj, attrs) {
      const _obj = _.clone(obj);
      attrs.map(attr => _.unset(_obj, attr));
      return _obj;
    }

    locations.forEach(location => {
      ctx[`check${_.capitalize(location)}`] = (param, failMsg) => {
        if (_.isPlainObject(param)) {
          return validateSchema(param, ctx, location, options);
        }

        return new ValidatorChain(param, failMsg, ctx, location, options);
      };
    });

    ctx.check = (param, failMsg) => {
      if (_.isPlainObject(param)) {
        return validateSchema(param, ctx, 'any', options);
      }

      return new ValidatorChain(param, failMsg, ctx, locate(ctx, param), options);
    };

    await next();
  };
};

module.exports = { koaValidator, KoaValidatorException }
