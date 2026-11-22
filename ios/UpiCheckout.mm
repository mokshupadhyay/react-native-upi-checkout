#import "UpiCheckout.h"

#import <UIKit/UIKit.h>

// iOS apps cannot return a payment result to the app that opened them, so
// this module only checks which apps can be opened and opens one. The list
// of apps and their URL templates lives in JavaScript (src/apps.ts) and is
// passed in, so there is one table to update.

static NSURL *UpiCheckoutURLFromValue(id value)
{
  if (![value isKindOfClass:[NSString class]] || [(NSString *)value length] == 0) return nil;
  return [NSURL URLWithString:(NSString *)value];
}

@implementation UpiCheckout

RCT_EXPORT_MODULE(UpiCheckout)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

// UIApplication's canOpenURL: and openURL: must be called on the main thread.
- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

// `candidates` holds `{ id, name, url }` entries. `canOpenURL:` only returns
// YES for schemes listed under LSApplicationQueriesSchemes in the host app's
// Info.plist; unlisted schemes are reported as not installed.
RCT_EXPORT_METHOD(getInstalledApps
                  : (NSArray *)candidates resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  UIApplication *application = [UIApplication sharedApplication];
  NSMutableArray<NSDictionary *> *apps = [NSMutableArray array];
  for (id candidate in candidates) {
    if (![candidate isKindOfClass:[NSDictionary class]]) continue;
    NSDictionary *entry = (NSDictionary *)candidate;
    id identifier = entry[@"id"];
    id name = entry[@"name"];
    NSURL *url = UpiCheckoutURLFromValue(entry[@"url"]);
    if (url == nil || ![identifier isKindOfClass:[NSString class]]) continue;
    if (![application canOpenURL:url]) continue;
    [apps addObject:@{
      @"id" : identifier,
      @"name" : [name isKindOfClass:[NSString class]] ? name : identifier,
    }];
  }
  resolve(apps);
}

// `packageName` and `chooserTitle` are Android options and are ignored here.
// Resolves as soon as iOS has opened the other app: no result comes back.
RCT_EXPORT_METHOD(pay
                  : (NSString *)url packageName
                  : (NSString *)packageName chooserTitle
                  : (NSString *)chooserTitle resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  NSURL *target = UpiCheckoutURLFromValue(url);
  if (target == nil) {
    reject(@"INVALID_PARAMS", @"The payment URL is not a valid URL.", nil);
    return;
  }
  // openURL: needs no LSApplicationQueriesSchemes entry, so a missing entry
  // in the host app's Info.plist cannot hide an installed app here. It
  // reports NO when no installed app handles the URL.
  [[UIApplication sharedApplication] openURL:target
                                     options:@{}
                           completionHandler:^(BOOL success) {
                             resolve(@{@"outcome" : success ? @"launched" : @"unavailable"});
                           }];
}

// iOS gets no result back from the UPI app, so there is nothing to keep
// natively. JavaScript keeps the `launched` / `unavailable` results itself.
RCT_EXPORT_METHOD(getLastResult
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  resolve([NSNull null]);
}

#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeUpiCheckoutSpecJSI>(params);
}
#endif

@end
